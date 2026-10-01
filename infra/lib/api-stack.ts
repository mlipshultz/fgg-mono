import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
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
}

/**
 * API Gateway HTTP API (v2) + Lambda handlers. HTTP API is used instead of REST because it is
 * cheaper, simpler, and has the native JWT authorizer the authenticated routes need later.
 */
export class ApiStack extends Stack {
  readonly api: apigw.HttpApi;
  readonly publicFn: NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config, table } = props;

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

    new CfnOutput(this, 'ApiUrl', { value: this.api.apiEndpoint });
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
