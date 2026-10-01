import { App, Tags } from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack.js';
import { AuthStack } from '../lib/auth-stack.js';
import { DataStack } from '../lib/data-stack.js';
import { GithubOidcStack } from '../lib/github-oidc-stack.js';
import { MediaStack } from '../lib/media-stack.js';
import { WebStack } from '../lib/web-stack.js';
import { PROJECT_TAG, REGION, parseStage, stageConfig } from '../lib/stage.js';

const app = new App();
const config = stageConfig(parseStage(app.node.tryGetContext('stage')));
const account = process.env.CDK_DEFAULT_ACCOUNT;
if (!account)
  throw new Error('CDK_DEFAULT_ACCOUNT is not set. Run with --profile fgg or OIDC credentials.');
const env = { account, region: REGION };

Tags.of(app).add('Project', PROJECT_TAG);

// Account-level, stage-independent. Deployed once; harmless to include in every deploy.
new GithubOidcStack(app, 'Fgg-GithubOidc', {
  env,
  githubRepo: config.githubRepo,
  githubSubjects: config.githubSubjects,
});

const data = new DataStack(app, `Fgg-${config.stage}-Data`, { env, config });
const auth = new AuthStack(app, `Fgg-${config.stage}-Auth`, { env, config, table: data.table });
const media = new MediaStack(app, `Fgg-${config.stage}-Media`, { env, config });
const web = new WebStack(app, `Fgg-${config.stage}-Web`, { env, config });
const api = new ApiStack(app, `Fgg-${config.stage}-Api`, {
  env,
  config,
  table: data.table,
  mediaBaseUrl: media.baseUrl,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
});

for (const stack of [auth, data, media, web, api]) Tags.of(stack).add('Stage', config.stage);
