import { App, Tags } from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack.js';
import { DataStack } from '../lib/data-stack.js';
import { GithubOidcStack } from '../lib/github-oidc-stack.js';
import { PROJECT_TAG, REGION, parseStage, stageConfig } from '../lib/stage.js';

const app = new App();
const config = stageConfig(parseStage(app.node.tryGetContext('stage')));
const account = process.env.CDK_DEFAULT_ACCOUNT;
if (!account)
  throw new Error('CDK_DEFAULT_ACCOUNT is not set. Run with --profile fgg or OIDC credentials.');
const env = { account, region: REGION };

Tags.of(app).add('Project', PROJECT_TAG);

// Account-level, stage-independent. Deployed once; harmless to include in every deploy.
new GithubOidcStack(app, 'Fgg-GithubOidc', { env, githubRepo: config.githubRepo });

const auth = new AuthStack(app, `Fgg-${config.stage}-Auth`, { env, config });
const data = new DataStack(app, `Fgg-${config.stage}-Data`, { env, config });

for (const stack of [auth, data]) Tags.of(stack).add('Stage', config.stage);
