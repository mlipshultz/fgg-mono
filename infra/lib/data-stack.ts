import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';
import type { StageConfig } from './stage.js';

export interface DataStackProps extends StackProps {
  config: StageConfig;
}

/** Single table + GSI1/GSI2 (docs/PLAN.md §3.4). The media bucket lives in MediaStack. */
export class DataStack extends Stack {
  readonly table: dynamodb.TableV2;

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

    new CfnOutput(this, 'TableName', { value: this.table.tableName });
  }
}
