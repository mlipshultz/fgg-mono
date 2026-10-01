import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';
import type { StageConfig } from './stage.js';

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
}

export class AuthStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly domain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `fgg-${config.stage}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        // Birth year drives the 13+ gate. Stored as a full date for the standard attribute.
        birthdate: { required: true, mutable: false },
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
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      enableTokenRevocation: true,
    });

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new CfnOutput(this, 'UserPoolDomain', {
      value: `${config.cognitoDomainPrefix}.auth.${this.region}.amazoncognito.com`,
    });
  }
}
