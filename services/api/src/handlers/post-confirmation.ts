import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import type { PostConfirmationTriggerEvent } from 'aws-lambda';
import type { User } from '@fgg/types';
import { createUserIfMissing } from '../lib/db.js';

const cognito = new CognitoIdentityProviderClient({});

export function displayNameFor(name: string | undefined, email: string | undefined): string {
  const n = name?.trim();
  if (n) return n.slice(0, 60);
  const local = (email ?? '').split('@')[0] ?? '';
  return (local || 'FGG Fan').slice(0, 60);
}

/**
 * Cognito PostConfirmation: create the USER record and put the user in the
 * `attendee` group. Idempotent, so a replay or a second confirmation is harmless.
 * Pool id comes from the event, so the trigger needs no USER_POOL_ID env.
 */
export const handler = async (
  event: PostConfirmationTriggerEvent,
): Promise<PostConfirmationTriggerEvent> => {
  const attrs = event.request.userAttributes;
  const sub = attrs.sub ?? event.userName;
  const email = (attrs.email ?? '').toLowerCase();
  const now = new Date().toISOString();
  const birthYear = Number((attrs.birthdate ?? '').slice(0, 4));
  const user: User = {
    sub,
    email: email || `${sub}@unknown.invalid`,
    displayName: displayNameFor(attrs.name ?? attrs.given_name, email),
    birthYear: Number.isFinite(birthYear) && birthYear >= 1900 ? birthYear : 1900,
    roles: ['attendee'],
    memberSince: now,
    createdAt: now,
    updatedAt: now,
  };
  await createUserIfMissing(user);
  try {
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: event.userPoolId,
        Username: event.userName,
        GroupName: 'attendee',
      }),
    );
  } catch (e) {
    // Group membership must never block confirmation; /me heals missing roles lazily.
    console.error('attendee group add failed', e);
  }
  return event;
};
