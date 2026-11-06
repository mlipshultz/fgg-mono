import {
  AdminAddUserToGroupCommand,
  AdminDeleteUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import type { Role } from '@fgg/types';

const cognito = new CognitoIdentityProviderClient({});
const poolId = () => process.env.USER_POOL_ID ?? '';

export async function addToGroup(sub: string, group: Role): Promise<void> {
  await cognito.send(
    new AdminAddUserToGroupCommand({ UserPoolId: poolId(), Username: sub, GroupName: group }),
  );
}

/** Remove a sign-in entirely (an under-13 account found after a Google sign-up). */
export async function deleteCognitoUser(username: string): Promise<void> {
  await cognito.send(new AdminDeleteUserCommand({ UserPoolId: poolId(), Username: username }));
}

/** Best effort: removing a group the user is not in is not an error worth failing on. */
export async function removeFromGroup(sub: string, group: Role): Promise<void> {
  try {
    await cognito.send(
      new AdminRemoveUserFromGroupCommand({
        UserPoolId: poolId(),
        Username: sub,
        GroupName: group,
      }),
    );
  } catch (err) {
    console.warn(`removeFromGroup ${group} failed`, err);
  }
}
