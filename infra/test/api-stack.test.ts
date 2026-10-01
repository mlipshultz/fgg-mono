import { describe, it } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { ApiStack } from '../lib/api-stack.js';
import { stageConfig } from '../lib/stage.js';

const env = { account: '123456789012', region: 'us-east-1' };

describe('ApiStack', () => {
  const app = new App();
  const dataStack = new Stack(app, 'Data', { env });
  const table = dynamodb.TableV2.fromTableName(dataStack, 'Table', 'fgg-dev');
  const userPool = cognito.UserPool.fromUserPoolId(dataStack, 'Pool', 'us-east-1_abc123');
  const userPoolClient = cognito.UserPoolClient.fromUserPoolClientId(
    dataStack,
    'Client',
    'client123',
  );
  const t = Template.fromStack(
    new ApiStack(app, 'Api', {
      env,
      config: stageConfig('dev'),
      table,
      mediaBaseUrl: 'https://media.test',
      userPool,
      userPoolClient,
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

  it('protects /me and /admin with a Cognito JWT authorizer', () => {
    t.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      JwtConfiguration: {
        Audience: ['client123'],
        Issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc123',
      },
    });
    for (const key of [
      'GET /me',
      'PATCH /me',
      'GET /me/{proxy+}',
      'PUT /me/{proxy+}',
      'DELETE /me/{proxy+}',
      'GET /admin/{proxy+}',
      'PUT /admin/{proxy+}',
    ]) {
      t.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: key,
        AuthorizationType: 'JWT',
      });
    }
    t.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /public/{proxy+}',
      AuthorizationType: 'NONE',
    });
    t.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ USER_POOL_ID: 'us-east-1_abc123' }) },
    });
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'cognito-idp:AdminAddUserToGroup',
              'cognito-idp:AdminRemoveUserFromGroup',
            ]),
          }),
        ]),
      }),
    });
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
