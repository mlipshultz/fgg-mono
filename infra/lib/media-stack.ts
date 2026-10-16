import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import type { Construct } from 'constructs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowedOrigins, type StageConfig } from './stage.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '../..');
/** sharp's native build for the Lambda (Linux, arm64, glibc); installed into the bundle. */
const SHARP_VERSION = '0.34.4';

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

    this.addGalleryResize();

    this.baseUrl = `https://${this.distribution.distributionDomainName}`;
    new CfnOutput(this, 'MediaBucketName', { value: this.bucket.bucketName });
    new CfnOutput(this, 'MediaBaseUrl', { value: this.baseUrl });
    new CfnOutput(this, 'MediaDistributionId', { value: this.distribution.distributionId });
  }

  /**
   * Gallery photos land in `gallery/originals/`; this writes the display and thumbnail copies
   * under `gallery/derived/`. It lives with the bucket because an S3 notification to a Lambda
   * in another stack would make the stacks depend on each other. The trigger is limited to the
   * originals prefix, so the copies it writes don't trigger it again.
   */
  private addGalleryResize(): void {
    const fn = new NodejsFunction(this, 'ResizeFn', {
      entry: path.join(REPO_ROOT, 'services/api/src/handlers/resize.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: Duration.seconds(60),
      logGroup: new logs.LogGroup(this, 'ResizeFnLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
      }),
      projectRoot: REPO_ROOT,
      depsLockFilePath: path.join(REPO_ROOT, 'pnpm-lock.yaml'),
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        mainFields: ['module', 'main'],
        sourceMap: true,
        // sharp is a native module: keep it out of the bundle and install the Linux arm64
        // build next to it (a local install on a Mac would ship the wrong binary).
        externalModules: ['sharp'],
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          // Each hook command runs on its own from the repo root, so every path is absolute
          // and nothing relies on `cd`.
          afterBundling: (_input: string, output: string) => [
            `echo '{"type":"module","dependencies":{}}' > "${output}/package.json"`,
            `npm install --prefix "${output}" --no-save --no-package-lock --no-audit --no-fund --os=linux --cpu=arm64 --libc=glibc sharp@${SHARP_VERSION}`,
          ],
        },
      },
    });
    this.bucket.grantRead(fn, 'gallery/originals/*');
    this.bucket.grantPut(fn, 'gallery/derived/*');
    this.bucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(fn), {
      prefix: 'gallery/originals/',
    });
  }
}
