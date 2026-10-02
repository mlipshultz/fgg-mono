import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StageConfig } from './stage.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '../..');
const API_SRC = path.join(REPO_ROOT, 'services/api/src');

export interface ApiStackProps extends StackProps {
  config: StageConfig;
  table: dynamodb.ITableV2;
  /** e.g. https://d123.cloudfront.net (the media distribution). */
  mediaBaseUrl: string;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
}

/**
 * API Gateway HTTP API (v2) + Lambda handlers. HTTP API is used instead of REST because it is
 * cheaper, simpler, and has the native JWT authorizer the authenticated routes need later.
 */
export class ApiStack extends Stack {
  readonly api: apigw.HttpApi;
  readonly publicFn: NodejsFunction;
  readonly accountFn: NodejsFunction;
  readonly shopifyFn: NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config, table, userPool, userPoolClient } = props;

    const origins = config.isProd
      ? config.webOrigins
      : [...new Set([...config.webOrigins, 'http://localhost:3000'])];

    this.api = new apigw.HttpApi(this, 'HttpApi', {
      apiName: `fgg-${config.stage}`,
      corsPreflight: {
        allowOrigins: origins,
        allowMethods: [
          apigw.CorsHttpMethod.GET,
          apigw.CorsHttpMethod.POST,
          apigw.CorsHttpMethod.PUT,
          apigw.CorsHttpMethod.PATCH,
          apigw.CorsHttpMethod.DELETE,
          apigw.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['content-type', 'authorization'],
        maxAge: Duration.hours(1),
      },
    });

    this.publicFn = this.lambda('PublicFn', 'handlers/public.ts', {
      TABLE_NAME: table.tableName,
      MEDIA_BASE_URL: props.mediaBaseUrl,
      STAGE: config.stage,
      WEB_ORIGINS: origins.join(','),
    });
    table.grantReadWriteData(this.publicFn);

    this.api.addRoutes({
      path: '/public/{proxy+}',
      methods: [apigw.HttpMethod.GET, apigw.HttpMethod.POST],
      integration: new HttpLambdaIntegration('PublicIntegration', this.publicFn),
    });

    // Authenticated routes: API Gateway validates the Cognito ID token; handlers read claims.
    const authorizer = new HttpJwtAuthorizer(
      'CognitoJwt',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [userPoolClient.userPoolClientId] },
    );
    this.accountFn = this.lambda('AccountFn', 'handlers/account.ts', {
      TABLE_NAME: table.tableName,
      MEDIA_BASE_URL: props.mediaBaseUrl,
      STAGE: config.stage,
      WEB_ORIGINS: origins.join(','),
      USER_POOL_ID: userPool.userPoolId,
    });
    table.grantReadWriteData(this.accountFn);
    this.accountFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:AdminRemoveUserFromGroup',
          'cognito-idp:AdminListGroupsForUser',
          'cognito-idp:AdminGetUser',
        ],
        resources: [userPool.userPoolArn],
      }),
    );
    const accountIntegration = new HttpLambdaIntegration('AccountIntegration', this.accountFn);
    const authed = [
      apigw.HttpMethod.GET,
      apigw.HttpMethod.POST,
      apigw.HttpMethod.PUT,
      apigw.HttpMethod.PATCH,
      apigw.HttpMethod.DELETE,
    ];
    for (const p of ['/me', '/me/{proxy+}', '/admin/{proxy+}']) {
      this.api.addRoutes({ path: p, methods: authed, integration: accountIntegration, authorizer });
    }

    // Shopify app install: exchanges the OAuth code and stores the Admin API token in the
    // stage's secret (`fgg/{stage}/shopify`), which staff create with shop/clientId/clientSecret.
    const shopifySecretName = `fgg/${config.stage}/shopify`;
    this.shopifyFn = this.lambda('ShopifyFn', 'handlers/shopify.ts', {
      STAGE: config.stage,
      WEB_ORIGINS: origins.join(','),
      SHOPIFY_SECRET_ID: shopifySecretName,
    });
    this.shopifyFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'secretsmanager:GetSecretValue',
          'secretsmanager:PutSecretValue',
          'secretsmanager:DescribeSecret',
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${shopifySecretName}-*`,
        ],
      }),
    );
    const shopifyIntegration = new HttpLambdaIntegration('ShopifyIntegration', this.shopifyFn);
    for (const p of ['/shopify/install', '/shopify/callback']) {
      this.api.addRoutes({
        path: p,
        methods: [apigw.HttpMethod.GET],
        integration: shopifyIntegration,
      });
    }

    new CfnOutput(this, 'ApiUrl', { value: this.api.apiEndpoint });
    new CfnOutput(this, 'ShopifyInstallUrl', { value: `${this.api.apiEndpoint}/shopify/install` });
    new CfnOutput(this, 'ShopifyCallbackUrl', {
      value: `${this.api.apiEndpoint}/shopify/callback`,
    });
  }

  private lambda(id: string, entry: string, environment: Record<string, string>): NodejsFunction {
    const logGroup = new logs.LogGroup(this, `${id}Logs`, {
      retention: logs.RetentionDays.ONE_MONTH,
    });
    return new NodejsFunction(this, id, {
      entry: path.join(API_SRC, entry),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(10),
      logGroup,
      environment,
      projectRoot: REPO_ROOT,
      depsLockFilePath: path.join(REPO_ROOT, 'pnpm-lock.yaml'),
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        mainFields: ['module', 'main'],
        sourceMap: true,
        minify: false,
        // AWS SDK v3 ships in the Node 22 runtime; keep it out of the bundle.
        externalModules: ['@aws-sdk/*'],
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });
  }
}
