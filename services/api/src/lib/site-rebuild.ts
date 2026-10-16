import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { HttpError } from './http.js';

/**
 * The public site is a static export, so published content only shows after a rebuild
 * (docs/PLAN.md §3.2). This fires the "Rebuild site" GitHub workflow through a
 * `repository_dispatch`, using a token staff store in Secrets Manager as
 * `fgg/{stage}/github`: `{ "token": "github_pat_…", "repo": "owner/name" }`.
 */
export type RebuildDispatcher = (stage: string) => Promise<void>;

const NOT_CONFIGURED =
  'Automatic rebuilds are not set up yet. Run the "Rebuild site" workflow from the GitHub Actions tab instead.';

let client: SecretsManagerClient | undefined;

async function dispatchViaGithub(stage: string): Promise<void> {
  const secretId = process.env.GITHUB_SECRET_ID;
  if (!secretId) throw new HttpError(409, 'rebuild_not_configured', NOT_CONFIGURED);
  let secret: { token?: string; repo?: string };
  try {
    client ??= new SecretsManagerClient({});
    const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    secret = JSON.parse(res.SecretString ?? '{}') as typeof secret;
  } catch (e) {
    if ((e as { name?: string }).name === 'ResourceNotFoundException')
      throw new HttpError(409, 'rebuild_not_configured', NOT_CONFIGURED);
    throw e;
  }
  if (!secret.token || !secret.repo)
    throw new HttpError(409, 'rebuild_not_configured', NOT_CONFIGURED);
  const res = await fetch(`https://api.github.com/repos/${secret.repo}/dispatches`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${secret.token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'fgg-api',
    },
    body: JSON.stringify({ event_type: 'rebuild-site', client_payload: { stage } }),
  });
  if (!res.ok) {
    console.error(`rebuild dispatch failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    throw new HttpError(502, 'rebuild_failed', 'GitHub did not accept the rebuild request');
  }
}

let dispatcher: RebuildDispatcher = dispatchViaGithub;

export function requestSiteRebuild(stage: string): Promise<void> {
  return dispatcher(stage);
}

/** Test hook. */
export function setRebuildDispatcher(d: RebuildDispatcher | undefined): void {
  dispatcher = d ?? dispatchViaGithub;
}
