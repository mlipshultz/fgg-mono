import { z } from 'zod';

/** Crockford base32 ULID, 26 chars. Used for every server-generated ID. */
export const Ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'ULID expected');
export type Ulid = z.infer<typeof Ulid>;

/**
 * Cognito subject. UUID-shaped, but Cognito does not set the RFC 4122 variant bits (federated
 * users get e.g. `...-7095-69b9-...`), so `z.uuid()` rejects real subs. Shape check only.
 */
export const CognitoSub = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Cognito sub expected');
export type CognitoSub = z.infer<typeof CognitoSub>;

/** Calendar date in the event's time zone, YYYY-MM-DD. */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD expected');
export type IsoDate = z.infer<typeof IsoDate>;

/** RFC 3339 instant with offset or Z. */
export const IsoDateTime = z.string().datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

export const Email = z.string().email().max(254);
export type Email = z.infer<typeof Email>;

/** Money is always integer cents in USD. */
export const Cents = z.number().int().nonnegative();
export type Cents = z.infer<typeof Cents>;

/** Human-readable URL slug. */
export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'kebab-case slug expected');
export type Slug = z.infer<typeof Slug>;

/** IANA time zone. Default for FGG events is America/New_York. */
export const TimeZone = z.string().min(1);
export type TimeZone = z.infer<typeof TimeZone>;
