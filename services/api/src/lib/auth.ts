import { Role, type User } from '@fgg/types';
import { HttpError, type Req } from './http.js';

export interface Actor {
  sub: string;
  email?: string;
  name?: string;
  roles: Role[];
}

type Claims = Record<string, unknown>;

/** Parse `cognito:groups`, which arrives as an array, a JSON-ish "[a b]" string, or "a,b". */
export function rolesFromGroups(raw: unknown): Role[] {
  let names: string[] = [];
  if (Array.isArray(raw)) names = raw.map(String);
  else if (typeof raw === 'string') {
    names = raw
      .replace(/^\[|\]$/g, '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return names.filter((n): n is Role => Role.safeParse(n).success);
}

/** The caller's identity from the API Gateway JWT authorizer. 401 when missing. */
export function claimsFrom(req: Req): Actor {
  const ctx = req.requestContext as unknown as { authorizer?: { jwt?: { claims?: Claims } } };
  const claims = ctx.authorizer?.jwt?.claims;
  const sub = typeof claims?.sub === 'string' ? claims.sub : undefined;
  if (!claims || !sub) throw new HttpError(401, 'unauthenticated', 'Sign in required');
  return {
    sub,
    ...(typeof claims.email === 'string' ? { email: claims.email } : {}),
    ...(typeof claims.name === 'string' ? { name: claims.name } : {}),
    roles: rolesFromGroups(claims['cognito:groups']),
  };
}

/** Contact details for vendor records come from the account, never from a form. */
export function contactFor(
  actor: Actor,
  user: Pick<User, 'displayName' | 'email'> | undefined,
): { contactName: string; email: string } {
  const email = (user?.email ?? actor.email ?? '').toLowerCase();
  if (!email) throw new HttpError(400, 'no_email', 'Your account has no email address');
  const name = (user?.displayName ?? actor.name ?? '').trim() || email.split('@')[0]!;
  return { contactName: name.slice(0, 120), email };
}
