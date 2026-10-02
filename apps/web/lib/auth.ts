import { Amplify } from 'aws-amplify';
import {
  confirmResetPassword as amplifyConfirmResetPassword,
  confirmSignUp as amplifyConfirmSignUp,
  fetchAuthSession,
  resendSignUpCode,
  resetPassword as amplifyResetPassword,
  signIn as amplifySignIn,
  signInWithRedirect,
  signOut as amplifySignOut,
  signUp as amplifySignUp,
} from 'aws-amplify/auth';
import type { Role } from '@fgg/types';

const POOL_ID = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? '';
const CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '';
const DOMAIN = process.env.NEXT_PUBLIC_COGNITO_DOMAIN ?? '';

/** True when the Cognito pool is configured for this build. */
export const hasAuth = POOL_ID.length > 0 && CLIENT_ID.length > 0;
export const hasGoogle = hasAuth && DOMAIN.length > 0;

export const ROLES: Role[] = ['attendee', 'vendor_applicant', 'vendor', 'staff', 'superadmin'];
const ROLE_SET = new Set<string>(ROLES);

let configured = false;

/** Idempotent. Call from a client component before any auth call. */
export function configureAmplify(): void {
  if (configured || !hasAuth || typeof window === 'undefined') return;
  const origin = window.location.origin;
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: POOL_ID,
        userPoolClientId: CLIENT_ID,
        ...(DOMAIN
          ? {
              loginWith: {
                oauth: {
                  domain: DOMAIN,
                  scopes: ['email', 'openid', 'profile'],
                  redirectSignIn: [`${origin}/auth/callback/`],
                  redirectSignOut: [`${origin}/`],
                  responseType: 'code' as const,
                },
              },
            }
          : {}),
      },
    },
  });
  configured = true;
}

export interface AuthUser {
  sub: string;
  email: string;
  name: string;
  roles: Role[];
}

function rolesFromClaim(claim: unknown): Role[] {
  const list = Array.isArray(claim)
    ? claim
    : typeof claim === 'string'
      ? claim.replace(/^\[|\]$/g, '').split(/[,\s]+/)
      : [];
  return list.map(String).filter((r): r is Role => ROLE_SET.has(r));
}

/**
 * The signed-in user from the ID token, or null. Never throws. `forceRefresh` trades the
 * refresh token for new tokens, which is how a role granted since sign-in (vendor approval)
 * reaches the client without signing out.
 */
export async function currentUser(forceRefresh = false): Promise<AuthUser | null> {
  if (!hasAuth) return null;
  try {
    configureAmplify();
    const session = await fetchAuthSession(forceRefresh ? { forceRefresh: true } : undefined);
    const payload = session.tokens?.idToken?.payload;
    if (!payload?.sub) return null;
    const email = typeof payload.email === 'string' ? payload.email : '';
    const name =
      (typeof payload.name === 'string' && payload.name) ||
      (typeof payload.given_name === 'string' && payload.given_name) ||
      email.split('@')[0] ||
      'Fan';
    return {
      sub: String(payload.sub),
      email,
      name,
      roles: rolesFromClaim(payload['cognito:groups']),
    };
  } catch {
    return null;
  }
}

/** ID token for `Authorization: Bearer`. Null when signed out. */
export async function getIdToken(): Promise<string | null> {
  if (!hasAuth) return null;
  try {
    configureAmplify();
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

export function isStaff(user: AuthUser | null): boolean {
  return !!user && (user.roles.includes('staff') || user.roles.includes('superadmin'));
}
export function isSuperAdmin(user: AuthUser | null): boolean {
  return !!user && user.roles.includes('superadmin');
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || 'F';
}

// ---------------------------------------------------------------------------
// Flows. Each returns a plain result; callers show friendlyAuthError(err).
// ---------------------------------------------------------------------------

export interface SignUpInput {
  name: string;
  email: string;
  birthYear: number;
  password: string;
}

export async function signUp(input: SignUpInput): Promise<{ needsConfirmation: boolean }> {
  configureAmplify();
  const res = await amplifySignUp({
    username: input.email.trim().toLowerCase(),
    password: input.password,
    options: {
      userAttributes: {
        email: input.email.trim().toLowerCase(),
        birthdate: `${input.birthYear}-01-01`,
        name: input.name.trim(),
      },
    },
  });
  return { needsConfirmation: res.nextStep.signUpStep === 'CONFIRM_SIGN_UP' };
}

export async function confirmSignUp(email: string, code: string): Promise<void> {
  configureAmplify();
  await amplifyConfirmSignUp({
    username: email.trim().toLowerCase(),
    confirmationCode: code.trim(),
  });
}

export async function resendCode(email: string): Promise<void> {
  configureAmplify();
  await resendSignUpCode({ username: email.trim().toLowerCase() });
}

export type SignInResult = 'done' | 'confirm' | 'other';

export async function signIn(email: string, password: string): Promise<SignInResult> {
  configureAmplify();
  const res = await amplifySignIn({ username: email.trim().toLowerCase(), password });
  if (res.isSignedIn) return 'done';
  if (res.nextStep.signInStep === 'CONFIRM_SIGN_UP') return 'confirm';
  return 'other';
}

export async function signOut(): Promise<void> {
  configureAmplify();
  await amplifySignOut();
}

export async function resetPassword(email: string): Promise<void> {
  configureAmplify();
  await amplifyResetPassword({ username: email.trim().toLowerCase() });
}

export async function confirmResetPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  configureAmplify();
  await amplifyConfirmResetPassword({
    username: email.trim().toLowerCase(),
    confirmationCode: code.trim(),
    newPassword,
  });
}

export async function googleSignIn(): Promise<void> {
  configureAmplify();
  await signInWithRedirect({ provider: 'Google' });
}

/** Password policy from the Cognito pool: 8+ chars, a lowercase letter and a digit. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (!/[a-z]/.test(pw)) return 'Add a lowercase letter.';
  if (!/\d/.test(pw)) return 'Add a number.';
  return null;
}

export const MINIMUM_AGE = 13;

export function isOldEnough(birthYear: number, now = new Date()): boolean {
  // Birth year only: someone born in (thisYear - 13) is treated as 13.
  return now.getFullYear() - birthYear >= MINIMUM_AGE;
}

/** Plain-words message for an Amplify / Cognito error. */
export function friendlyAuthError(err: unknown): string {
  const name = (err as { name?: string } | undefined)?.name ?? '';
  const message = (err as { message?: string } | undefined)?.message ?? '';
  switch (name) {
    case 'NotAuthorizedException':
    case 'UserNotFoundException':
      return "That email and password don't match.";
    case 'UserNotConfirmedException':
      return 'Please verify your email first.';
    case 'UsernameExistsException':
      return 'An account with that email already exists. Try logging in.';
    case 'InvalidPasswordException':
      return 'Passwords need at least 8 characters, with a lowercase letter and a number.';
    case 'CodeMismatchException':
      return "That code doesn't match. Check your email and try again.";
    case 'ExpiredCodeException':
      return 'That code has expired. Request a new one.';
    case 'LimitExceededException':
    case 'TooManyRequestsException':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'UserLambdaValidationException':
      return message.replace(/^PreSignUp failed with error\s*/i, '').replace(/\.?\s*$/, '.');
    case 'UserAlreadyAuthenticatedException':
      return "You're already logged in.";
    default:
      return message || 'Something went wrong. Try again?';
  }
}
