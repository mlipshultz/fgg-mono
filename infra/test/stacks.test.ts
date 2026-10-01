import { describe, it } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AuthStack, ROLE_GROUPS } from '../lib/auth-stack.js';
import { DataStack } from '../lib/data-stack.js';
import { GithubOidcStack } from '../lib/github-oidc-stack.js';
import { stageConfig } from '../lib/stage.js';

const env = { account: '123456789012', region: 'us-east-1' };

describe('AuthStack', () => {
  const t = Template.fromStack(
    new AuthStack(new App(), 'Auth', { env, config: stageConfig('dev') }),
  );

  it('creates one group per role', () => {
    t.resourceCountIs('AWS::Cognito::UserPoolGroup', ROLE_GROUPS.length);
    for (const g of ROLE_GROUPS)
      t.hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: g.name });
  });

  it('uses a public SRP client with no secret', () => {
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH']),
    });
  });

  it('is disposable in dev and retained in prod', () => {
    t.hasResource('AWS::Cognito::UserPool', { DeletionPolicy: 'Delete' });
    const prod = Template.fromStack(
      new AuthStack(new App(), 'AuthProd', { env, config: stageConfig('prod') }),
    );
    prod.hasResource('AWS::Cognito::UserPool', { DeletionPolicy: 'Retain' });
  });
});

describe('DataStack', () => {
  const t = Template.fromStack(
    new DataStack(new App(), 'Data', { env, config: stageConfig('dev') }),
  );

  it('has PK/SK, two GSIs and TTL', () => {
    t.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TableName: 'fgg-dev',
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({ IndexName: 'GSI1' }),
        Match.objectLike({ IndexName: 'GSI2' }),
      ]),
    });
  });

  it('keeps the media bucket private', () => {
    t.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: Match.objectLike({
        BlockPublicAcls: true,
        RestrictPublicBuckets: true,
      }),
    });
  });
});

describe('GithubOidcStack', () => {
  const t = Template.fromStack(
    new GithubOidcStack(new App(), 'Oidc', {
      env,
      githubRepo: 'mlipshultz/fgg-mono',
      githubSubjects: ['repo:mlipshultz/fgg-mono:*', 'repo:mlipshultz@1/fgg-mono@2:*'],
    }),
  );

  it('limits the trust to the repo and the role to CDK bootstrap roles', () => {
    t.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'fgg-github-deploy',
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: [
          Match.objectLike({
            Condition: {
              StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
              StringLike: {
                'token.actions.githubusercontent.com:sub': [
                  'repo:mlipshultz/fgg-mono:*',
                  'repo:mlipshultz@1/fgg-mono@2:*',
                ],
              },
            },
          }),
        ],
      }),
    });
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([Match.objectLike({ Action: 'sts:AssumeRole' })]),
      }),
    });
  });
});
