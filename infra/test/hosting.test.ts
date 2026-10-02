import { describe, it } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { MediaStack } from '../lib/media-stack.js';
import { WebStack } from '../lib/web-stack.js';
import { stageConfig } from '../lib/stage.js';

const env = { account: '123456789012', region: 'us-east-1' };

describe('WebStack', () => {
  const t = Template.fromStack(new WebStack(new App(), 'Web', { env, config: stageConfig('dev') }));

  it('serves a private bucket through CloudFront with an index rewrite and 404 page', () => {
    t.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'fgg-web-dev-123456789012',
      PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicAcls: true }),
    });
    t.resourceCountIs('AWS::CloudFront::Function', 1);
    t.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 404, ResponsePagePath: '/404.html' }),
        ]),
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
      }),
    });
  });
});

describe('MediaStack', () => {
  it('owns a private media bucket fronted by an OAC distribution', () => {
    const t = Template.fromStack(
      new MediaStack(new App(), 'Media', {
        env,
        config: stageConfig('dev'),
        webUrl: 'https://d123.cloudfront.net',
      }),
    );
    t.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'fgg-media-dev-123456789012',
      PublicAccessBlockConfiguration: Match.objectLike({
        BlockPublicAcls: true,
        RestrictPublicBuckets: true,
      }),
    });
    t.resourceCountIs('AWS::CloudFront::Distribution', 1);
    t.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  });
});
