/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

process.env.TABLE_NAME = 'fgg-test';
const ddb = mockClient(DynamoDBDocumentClient);
const cognito = mockClient(CognitoIdentityProviderClient);
const {
  handler: preSignUp,
  ageOn,
  UNDER_AGE_MESSAGE,
} = await import('../src/handlers/pre-signup.js');
const { handler: postConfirmation } = await import('../src/handlers/post-confirmation.js');

const today = new Date('2026-10-01T12:00:00Z');

function signupEvent(attrs: Record<string, string>, triggerSource = 'PreSignUp_SignUp'): any {
  return {
    version: '1',
    region: 'us-east-1',
    userPoolId: 'us-east-1_test',
    userName: 'abc',
    triggerSource,
    callerContext: { awsSdkVersion: 'x', clientId: 'c' },
    request: { userAttributes: attrs, validationData: {} },
    response: { autoConfirmUser: false, autoVerifyEmail: false, autoVerifyPhone: false },
  };
}

describe('ageOn', () => {
  it('counts whole years and respects the birthday', () => {
    expect(ageOn('2013-10-01', today)).toBe(13);
    expect(ageOn('2013-10-02', today)).toBe(12);
    expect(ageOn('nope', today)).toBeNaN();
  });
});

describe('pre-signup', () => {
  it('allows 13+, rejects under 13 with the parent message, requires a birthdate', async () => {
    const thirteen = new Date(today);
    thirteen.setUTCFullYear(today.getUTCFullYear() - 13);
    const twelve = new Date(today);
    twelve.setUTCFullYear(today.getUTCFullYear() - 12);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const ok = signupEvent({ email: 'a@b.c', birthdate: iso(thirteen) });
    await expect(preSignUp(ok)).resolves.toMatchObject({ response: { autoConfirmUser: false } });
    await expect(
      preSignUp(signupEvent({ email: 'a@b.c', birthdate: iso(twelve) })),
    ).rejects.toThrow(UNDER_AGE_MESSAGE);
    await expect(preSignUp(signupEvent({ email: 'a@b.c' }))).rejects.toThrow(/birthdate/i);
  });
  it('passes Google sign-ups through without a birthdate', async () => {
    const ev = signupEvent({ email: 'a@b.c' }, 'PreSignUp_ExternalProvider');
    await expect(preSignUp(ev)).resolves.toBe(ev);
  });
});

describe('post-confirmation', () => {
  beforeEach(() => {
    ddb.reset();
    cognito.reset();
    cognito.on(AdminAddUserToGroupCommand).resolves({});
  });
  function confirmEvent(): any {
    return {
      ...signupEvent(
        {
          sub: '2f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d',
          email: 'Maya@Example.com',
          birthdate: '2010-05-04',
          name: 'Maya J',
        },
        'PostConfirmation_ConfirmSignUp',
      ),
      response: {},
    };
  }
  it('creates the user with the attendee role and adds the group', async () => {
    ddb.on(PutCommand).resolves({});
    await postConfirmation(confirmEvent());
    const put = ddb.commandCalls(PutCommand)[0]!.args[0].input;
    expect(put.ConditionExpression).toBe('attribute_not_exists(PK)');
    expect(put.Item).toMatchObject({
      PK: 'USER#2f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d',
      GSI1PK: 'EMAIL#maya@example.com',
      displayName: 'Maya J',
      birthYear: 2010,
      roles: ['attendee'],
    });
    expect(put.Item!.GSI2PK).toMatch(/^USERS#\d$/);
    const add = cognito.commandCalls(AdminAddUserToGroupCommand)[0]!.args[0].input;
    expect(add).toMatchObject({
      UserPoolId: 'us-east-1_test',
      Username: 'abc',
      GroupName: 'attendee',
    });
  });
  it('is idempotent and never fails confirmation on a group error', async () => {
    const err = Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' });
    ddb.on(PutCommand).rejects(err);
    cognito.on(AdminAddUserToGroupCommand).rejects(new Error('boom'));
    const ev = confirmEvent();
    await expect(postConfirmation(ev)).resolves.toBe(ev);
  });
});
