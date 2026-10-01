import type { PreSignUpTriggerEvent } from 'aws-lambda';
import { MINIMUM_AGE } from '@fgg/types';

export const UNDER_AGE_MESSAGE =
  'You must be 13 or older to create an account. Ask a parent to sign up with you.';

/** Age in whole years on `today` for a YYYY-MM-DD birthdate. */
export function ageOn(birthdate: string, today = new Date()): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthdate);
  if (!m) return Number.NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = today.getUTCFullYear() - y;
  const beforeBirthday =
    today.getUTCMonth() + 1 < mo || (today.getUTCMonth() + 1 === mo && today.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * Cognito PreSignUp: enforce the 13+ gate server-side. External-provider sign-ups
 * (Google) carry no birthdate yet; the client collects it afterwards. Never auto-confirms.
 */
export const handler = async (event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> => {
  if (event.triggerSource === 'PreSignUp_ExternalProvider') return event;
  const birthdate = event.request.userAttributes.birthdate;
  if (!birthdate) throw new Error('A birthdate is required to create an account.');
  const age = ageOn(birthdate);
  if (Number.isNaN(age)) throw new Error('Birthdate must be in YYYY-MM-DD format.');
  if (age < MINIMUM_AGE) throw new Error(UNDER_AGE_MESSAGE);
  return event;
};
