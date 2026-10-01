import { describe, it } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { ApiStack } from '../lib/api-stack.js';
import { stageConfig } from '../lib/stage.js';

const env = { account: '123456789012', region: 'us-east-1' };

describe('ApiStack', () => {
  const app = new App();
  const dataStack = new Stack(app, 'Data', { env });
  const table = dynamodb.TableV2.fromTableName(dataStack, 'Table', 'fgg-dev');
  const t = Template.fromStack(
    new ApiStack(app, 'Api', {
      env,
      config: stageConfig('dev'),
      table,
      mediaBaseUrl: 'https://media.test',
    }),
  );

  it('creates an HTTP API with CORS for the web origins', () => {
    t.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      ProtocolType: 'HTTP',
      CorsConfiguration: Match.objectLike({
        AllowOrigins: Match.arrayWith(['http://localhost:3000']),
      }),
    });
  });

  it('routes /public/{proxy+} for GET and POST to the public Lambda', () => {
    t.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /public/{proxy+}' });
    t.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'POST /public/{proxy+}' });
  });

  it('configures the Lambda runtime and environment', () => {
    t.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      Environment: {
        Variables: Match.objectLike({
          TABLE_NAME: 'fgg-dev',
          MEDIA_BASE_URL: 'https://media.test',
          STAGE: 'dev',
          WEB_ORIGINS: Match.stringLikeRegexp('localhost:3000'),
        }),
      },
    });
    t.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 30 });
  });
});
