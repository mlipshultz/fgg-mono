import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { allowedOrigins, type StageConfig } from './stage.js';

export interface MediaStackProps extends StackProps {
  config: StageConfig;
  /** The web distribution URL; browsers there PUT presigned uploads straight to the bucket. */
  webUrl: string;
}

/**
 * Private media bucket (posters, gallery, hero video) and the CloudFront
 * distribution in front of it. Both live here because the OAC bucket policy
 * references the distribution, which would be a cross-stack cycle otherwise.
 */
export class MediaStack extends Stack {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;
  /** e.g. https://d1234.cloudfront.net (no trailing slash). */
  readonly baseUrl: string;

  constructor(scope: Construct, id: string, props: MediaStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.bucket = new s3.Bucket(this, 'MediaBucket', {
      bucketName: `fgg-media-${config.stage}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: config.isProd,
      removalPolicy: config.removalPolicy,
      autoDeleteObjects: !config.isProd,
      cors: [
        {
          // Presigned uploads from the site (vendor logos, later the admin console).
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: allowedOrigins(config, props.webUrl),
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(2) }],
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `fgg media ${config.stage}`,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy:
          cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT,
        compress: true,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    this.baseUrl = `https://${this.distribution.distributionDomainName}`;
    new CfnOutput(this, 'MediaBucketName', { value: this.bucket.bucketName });
    new CfnOutput(this, 'MediaBaseUrl', { value: this.baseUrl });
    new CfnOutput(this, 'MediaDistributionId', { value: this.distribution.distributionId });
  }
}
