import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export interface GithubOidcStackProps extends StackProps {
  githubRepo: string;
}

/**
 * Account-level (not per stage): the GitHub OIDC provider and one deploy role.
 * The role can only assume the CDK bootstrap roles, so CDK's own least-privilege
 * roles do the actual work. Web-bucket sync permissions are added in Phase 1.
 */
export class GithubOidcStack extends Stack {
  readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    const provider = new iam.OpenIdConnectProvider(this, 'GithubProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    this.deployRole = new iam.Role(this, 'DeployRole', {
      roleName: 'fgg-github-deploy',
      description:
        'Assumed by GitHub Actions in fgg-mono to run cdk diff/deploy and sync the web bucket.',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike: { 'token.actions.githubusercontent.com:sub': `repo:${props.githubRepo}:*` },
      }),
    });

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
      }),
    );

    new CfnOutput(this, 'DeployRoleArn', { value: this.deployRole.roleArn });
  }
}
