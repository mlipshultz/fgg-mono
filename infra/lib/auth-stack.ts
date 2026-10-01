import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StageConfig } from './stage.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '../..');
const API_SRC = path.join(REPO_ROOT, 'services/api/src');

/** Secrets Manager secret holding `<stage>_google_client_id` / `<stage>_google_client_secret`. */
export const GOOGLE_SSO_SECRET = 'fgg/google-sso';

/** Cognito groups, one per role (docs/PLAN.md §3.3). Order matters for precedence. */
export const ROLE_GROUPS = [
  { name: 'attendee', description: 'Default. Profile, XP, badges, saved events.', precedence: 50 },
  {
    name: 'vendor_applicant',
    description: 'Applied to vend; cannot book until approved.',
    precedence: 40,
  },
  { name: 'vendor', description: 'Approved vendor. Can book and pay for tables.', precedence: 30 },
  {
    name: 'staff',
    description: 'Scan check-ins, review applications, manage events.',
    precedence: 20,
  },
  {
    name: 'superadmin',
    description: 'Everything, plus roles, refunds, pricing and game config.',
    precedence: 10,
  },
] as const;

export interface AuthStackProps extends StackProps {
  config: StageConfig;
  /** For the post-confirmation trigger, which creates the USER record. */
  table: dynamodb.ITableV2;
}

export class AuthStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly domain: cognito.UserPoolDomain;
  readonly preSignUpFn: NodejsFunction;
  readonly postConfirmationFn: NodejsFunction;
  /** Whether the Google identity provider was attached (needs the secret to exist). */
  readonly googleEnabled: boolean;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    const { config, table } = props;

    // Triggers. The pool id is not known until the pool exists, so post-confirmation reads
    // it from the event instead of an env var; the group grant uses a wildcard for the same reason.
    this.preSignUpFn = this.trigger('PreSignUpFn', 'handlers/pre-signup.ts', {
      STAGE: config.stage,
    });
    this.postConfirmationFn = this.trigger('PostConfirmationFn', 'handlers/post-confirmation.ts', {
      STAGE: config.stage,
      TABLE_NAME: table.tableName,
    });
    table.grantReadWriteData(this.postConfirmationFn);
    this.postConfirmationFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminAddUserToGroup'],
        resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`],
      }),
    );

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `fgg-${config.stage}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        // Optional at the pool level: Google users have none at sign-up. The 13+ gate is
        // enforced by the pre-signup trigger (native) and the client (external).
        birthdate: { required: false, mutable: true },
        givenName: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: false,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OFF,
      userVerification: {
        emailSubject: 'Your Feel Good Gaming verification code',
        emailBody: 'Welcome to Feel Good Gaming! Your verification code is {####}.',
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      deletionProtection: config.isProd,
      removalPolicy: config.removalPolicy,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      lambdaTriggers: {
        preSignUp: this.preSignUpFn,
        postConfirmation: this.postConfirmationFn,
      },
    });

    for (const group of ROLE_GROUPS) {
      new cognito.CfnUserPoolGroup(this, `Group-${group.name}`, {
        userPoolId: this.userPool.userPoolId,
        groupName: group.name,
        description: group.description,
        precedence: group.precedence,
      });
    }

    this.domain = this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: config.cognitoDomainPrefix },
    });

    // Google sign-in through the hosted UI. Credentials live in Secrets Manager, never the repo.
    // On by default in dev; prod opts in with `-c googleSso=true` once its keys exist.
    const googleCtx = this.node.tryGetContext('googleSso') as boolean | string | undefined;
    this.googleEnabled =
      googleCtx === true || googleCtx === 'true' || (googleCtx === undefined && !config.isProd);
    const providers = [cognito.UserPoolClientIdentityProvider.COGNITO];
    let google: cognito.UserPoolIdentityProviderGoogle | undefined;
    if (this.googleEnabled) {
      const secret = secretsmanager.Secret.fromSecretNameV2(this, 'GoogleSso', GOOGLE_SSO_SECRET);
      google = new cognito.UserPoolIdentityProviderGoogle(this, 'Google', {
        userPool: this.userPool,
        clientId: secret.secretValueFromJson(`${config.stage}_google_client_id`).unsafeUnwrap(),
        clientSecretValue: secret.secretValueFromJson(`${config.stage}_google_client_secret`),
        scopes: ['profile', 'email', 'openid'],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
          familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
          fullname: cognito.ProviderAttribute.GOOGLE_NAME,
        },
      });
      providers.push(cognito.UserPoolClientIdentityProvider.GOOGLE);
    }

    // One public client shared by web and mobile. SRP for email/password; the hosted UI
    // (authorization code grant) is only used for Google and, later, Apple.
    this.userPoolClient = this.userPool.addClient('AppClient', {
      userPoolClientName: `fgg-${config.stage}-app`,
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
        callbackUrls: [
          ...config.webOrigins.map((o) => `${o}/auth/callback/`),
          'fgg://auth/callback',
        ],
        logoutUrls: [...config.webOrigins.map((o) => `${o}/`), 'fgg://auth/signout'],
      },
      supportedIdentityProviders: providers,
      readAttributes: new cognito.ClientAttributes().withStandardAttributes({
        email: true,
        emailVerified: true,
        birthdate: true,
        givenName: true,
        familyName: true,
        fullname: true,
      }),
      writeAttributes: new cognito.ClientAttributes().withStandardAttributes({
        email: true,
        birthdate: true,
        givenName: true,
        familyName: true,
        fullname: true,
      }),
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      enableTokenRevocation: true,
    });

    if (google) this.userPoolClient.node.addDependency(google);

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'GoogleSsoEnabled', { value: this.googleEnabled ? 'enabled' : 'disabled' });
    new CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new CfnOutput(this, 'UserPoolDomain', {
      value: `${config.cognitoDomainPrefix}.auth.${this.region}.amazoncognito.com`,
    });
  }

  private trigger(id: string, entry: string, environment: Record<string, string>): NodejsFunction {
    const logGroup = new logs.LogGroup(this, `${id}Logs`, {
      retention: logs.RetentionDays.ONE_MONTH,
    });
    return new NodejsFunction(this, id, {
      entry: path.join(API_SRC, entry),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(5),
      logGroup,
      environment,
      projectRoot: REPO_ROOT,
      depsLockFilePath: path.join(REPO_ROOT, 'pnpm-lock.yaml'),
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        mainFields: ['module', 'main'],
        sourceMap: true,
        minify: false,
        externalModules: ['@aws-sdk/*'],
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });
  }
}
