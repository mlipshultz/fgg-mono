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
import type * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowedOrigins, type StageConfig } from './stage.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '../..');
const API_SRC = path.join(REPO_ROOT, 'services/api/src');

export interface ApiStackProps extends StackProps {
  config: StageConfig;
  table: dynamodb.ITableV2;
  /** e.g. https://d123.cloudfront.net (the media distribution). */
  mediaBaseUrl: string;
  /** The media bucket, for presigned uploads (vendor logos under `vendors/`). */
  mediaBucket: s3.IBucket;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  /** The web distribution URL; allowed as a CORS origin and used for Shopify return links. */
  webUrl: string;
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
  readonly vendorFn: NodejsFunction;
  readonly webhookFn: NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config, table, userPool, userPoolClient } = props;

    const origins = allowedOrigins(config, props.webUrl);
    // Where Shopify sends vendors after checkout. Prod uses the real hostname; dev has only
    // the distribution.
    const webUrl = config.isProd ? (config.webOrigins[0] ?? props.webUrl) : props.webUrl;

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
    const secretArn = `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${shopifySecretName}-*`;
    const secretRead = new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
      resources: [secretArn],
    });
    this.shopifyFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'secretsmanager:GetSecretValue',
          'secretsmanager:PutSecretValue',
          'secretsmanager:DescribeSecret',
        ],
        resources: [secretArn],
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

    // Vendor booking (holds, checkout, orders, dashboard) — JWT required; the handler checks the
    // vendor role. Needs the Shopify secret to create draft orders.
    this.vendorFn = this.lambda('VendorFn', 'handlers/vendor.ts', {
      TABLE_NAME: table.tableName,
      MEDIA_BASE_URL: props.mediaBaseUrl,
      STAGE: config.stage,
      WEB_ORIGINS: origins.join(','),
      SHOPIFY_SECRET_ID: shopifySecretName,
      WEB_URL: webUrl,
      MEDIA_BUCKET: props.mediaBucket.bucketName,
    });
    table.grantReadWriteData(this.vendorFn);
    this.vendorFn.addToRolePolicy(secretRead);
    // Presigned PUTs are signed with this role, so it needs the write it is delegating.
    props.mediaBucket.grantPut(this.vendorFn, 'vendors/*');
    this.api.addRoutes({
      path: '/vendor/{proxy+}',
      methods: authed,
      integration: new HttpLambdaIntegration('VendorIntegration', this.vendorFn),
      authorizer,
    });

    // Shopify webhooks (orders/paid, refunds/create): HMAC-verified in code, no JWT.
    this.webhookFn = this.lambda('WebhookFn', 'handlers/webhooks.ts', {
      TABLE_NAME: table.tableName,
      MEDIA_BASE_URL: props.mediaBaseUrl,
      STAGE: config.stage,
      WEB_ORIGINS: origins.join(','),
      SHOPIFY_SECRET_ID: shopifySecretName,
    });
    table.grantReadWriteData(this.webhookFn);
    this.webhookFn.addToRolePolicy(secretRead);
    this.api.addRoutes({
      path: '/webhooks/shopify',
      methods: [apigw.HttpMethod.POST],
      integration: new HttpLambdaIntegration('WebhookIntegration', this.webhookFn),
    });

    // Account fn now also approves vendors (groups) and refunds/registers webhooks (Shopify secret).
    this.accountFn.addEnvironment('SHOPIFY_SECRET_ID', shopifySecretName);
    this.accountFn.addToRolePolicy(secretRead);

    new CfnOutput(this, 'ApiUrl', { value: this.api.apiEndpoint });
    new CfnOutput(this, 'ShopifyWebhookUrl', { value: `${this.api.apiEndpoint}/webhooks/shopify` });
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
        // The runtime's AWS SDK v3 covers the clients below. S3 + the request presigner are
        // bundled so their @smithy internals match each other.
        externalModules: [
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/lib-dynamodb',
          '@aws-sdk/client-sesv2',
          '@aws-sdk/client-cognito-identity-provider',
          '@aws-sdk/client-secrets-manager',
        ],
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });
  }
}
