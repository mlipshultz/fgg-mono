import { z } from 'zod';
import { CognitoSub, IsoDateTime, Ulid } from './common.js';

export const XpSource = z.enum(['checkin', 'challenge', 'raffle', 'adjustment']);
export type XpSource = z.infer<typeof XpSource>;

/** One XP award. scanId is generated on the staff device so replays are idempotent. */
export const XpTransaction = z.object({
  scanId: Ulid,
  userSub: CognitoSub,
  eventId: Ulid,
  source: XpSource,
  challengeId: Ulid.optional(),
  amount: z.number().int(),
  awardedBy: z.union([CognitoSub, z.literal('system')]),
  at: IsoDateTime,
});
export type XpTransaction = z.infer<typeof XpTransaction>;

/** Placeholder level config (handoff §0A). Data-driven so real values drop in later. */
export const Level = z.object({
  level: z.number().int().positive(),
  title: z.string().min(1).max(40),
  /** Cumulative XP required to reach this level. Level 1 is 0. */
  xpRequired: z.number().int().nonnegative(),
  unlocks: z.string().max(200).optional(),
});
export type Level = z.infer<typeof Level>;

export const Badge = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1).max(60),
  description: z.string().max(200),
  artKey: z.string().optional(),
  sortOrder: z.number().int(),
  /** Rule the server evaluates after each XP transaction. */
  criteria: z.discriminatedUnion('type', [
    z.object({ type: z.literal('first_checkin') }),
    z.object({ type: z.literal('checkins'), count: z.number().int().positive() }),
    z.object({ type: z.literal('challenge'), challengeId: Ulid }),
    z.object({ type: z.literal('level'), level: z.number().int().positive() }),
    z.object({ type: z.literal('manual') }),
  ]),
});
export type Badge = z.infer<typeof Badge>;

export const Challenge = z.object({
  id: Ulid,
  eventId: Ulid,
  name: z.string().min(1).max(80),
  xp: z.number().int().positive(),
  activityId: z.string().optional(),
  oncePerUser: z.boolean().default(true),
});
export type Challenge = z.infer<typeof Challenge>;
