import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import type { StageConfig } from './stage.js';

export interface DataStackProps extends StackProps {
  config: StageConfig;
}

/** Single table + GSI1/GSI2 (docs/PLAN.md §3.4) and the private media bucket. */
export class DataStack extends Stack {
  readonly table: dynamodb.TableV2;
  readonly mediaBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.table = new dynamodb.TableV2(this, 'Table', {
      tableName: `fgg-${config.stage}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: config.isProd },
      deletionProtection: config.isProd,
      removalPolicy: config.removalPolicy,
      globalSecondaryIndexes: [
        {
          // Owner / parent lookups: my orders, my holds, my vendor, event audit, email → user.
          indexName: 'GSI1',
          partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
          projectionType: dynamodb.ProjectionType.ALL,
        },
        {
          // Admin list and status views: users by shard, orders by status, slug → event.
          indexName: 'GSI2',
          partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
          projectionType: dynamodb.ProjectionType.ALL,
        },
      ],
    });

    this.mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      bucketName: `fgg-media-${config.stage}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: config.isProd,
      removalPolicy: config.removalPolicy,
      autoDeleteObjects: !config.isProd,
      cors: [
        {
          // Presigned uploads from the admin console.
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: config.webOrigins,
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(2) }],
    });

    new CfnOutput(this, 'TableName', { value: this.table.tableName });
    new CfnOutput(this, 'MediaBucketName', { value: this.mediaBucket.bucketName });
  }
}
