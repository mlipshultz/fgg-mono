import { RemovalPolicy } from 'aws-cdk-lib';

export const STAGES = ['dev', 'prod'] as const;
export type Stage = (typeof STAGES)[number];

export function parseStage(value: unknown): Stage {
  if (typeof value === 'string' && (STAGES as readonly string[]).includes(value))
    return value as Stage;
  throw new Error(`Missing or invalid stage. Pass -c stage=dev|prod (got ${String(value)})`);
}

export interface StageConfig {
  stage: Stage;
  isProd: boolean;
  /** Stateful resources: dev is disposable, prod survives a stack delete. */
  removalPolicy: RemovalPolicy;
  /** Allowed OAuth callback origins for the Cognito hosted UI (Google sign-in). */
  webOrigins: string[];
  /** Cognito hosted-UI domain prefix. Globally unique per region. */
  cognitoDomainPrefix: string;
  githubRepo: string;
  /** Subject patterns the deploy role trusts. GitHub issues immutable subjects with IDs
   *  (`repo:owner@id/repo@id:...`); the plain form is kept for older tokens. */
  githubSubjects: string[];
}

export function stageConfig(stage: Stage): StageConfig {
  const isProd = stage === 'prod';
  return {
    stage,
    isProd,
    removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    webOrigins: isProd
      ? ['https://feelgoodgaming.com', 'https://www.feelgoodgaming.com']
      : ['http://localhost:3000'],
    cognitoDomainPrefix: `feelgoodgaming-${stage}`,
    githubRepo: 'mlipshultz/fgg-mono',
    githubSubjects: ['repo:mlipshultz/fgg-mono:*', 'repo:mlipshultz@8192110/fgg-mono@1398552177:*'],
  };
}

export const REGION = 'us-east-1';
export const PROJECT_TAG = 'fgg';
