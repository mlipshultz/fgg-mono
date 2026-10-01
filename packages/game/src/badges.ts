import type { Badge, Level } from '@fgg/types';
import { DEFAULT_LEVELS, levelFromXp } from './levels.js';

/** Placeholder badge catalog from the design canvas. Art keys arrive with the custom icon set. */
export const DEFAULT_BADGES: readonly Badge[] = [
  {
    id: 'first-fest',
    title: 'First Fest',
    description: 'Checked in to your first FGG show.',
    sortOrder: 1,
    criteria: { type: 'first_checkin' },
  },
  {
    id: 'trader',
    title: 'Trader',
    description: 'Made a trade at the supervised trading tables.',
    sortOrder: 2,
    criteria: { type: 'manual' },
  },
  {
    id: 'artist',
    title: 'Artist',
    description: 'Designed a creature card at the Art Station.',
    sortOrder: 3,
    criteria: { type: 'manual' },
  },
  {
    id: 'good-neighbor',
    title: 'Good Neighbor',
    description: 'Donated to Cards for Cans.',
    sortOrder: 4,
    criteria: { type: 'manual' },
  },
  {
    id: 'harbor-2026',
    title: 'Harbor 2026',
    description: 'Attended Harbor Fest 2026.',
    sortOrder: 5,
    criteria: { type: 'manual' },
  },
  {
    id: 'raffle-regular',
    title: 'Raffle Regular',
    description: 'Entered three raffles.',
    sortOrder: 6,
    criteria: { type: 'manual' },
  },
  {
    id: 'found-em-all',
    title: "Found 'Em All",
    description: "Completed a Find 'Em All hunt.",
    sortOrder: 7,
    criteria: { type: 'manual' },
  },
  {
    id: 'bracket-buster',
    title: 'Bracket Buster',
    description: 'Played in a tournament bracket.',
    sortOrder: 8,
    criteria: { type: 'manual' },
  },
  {
    id: 'summer-2026',
    title: 'Summer 2026',
    description: 'Attended Summer Fest 2026.',
    sortOrder: 9,
    criteria: { type: 'manual' },
  },
  {
    id: 'costume-champ',
    title: 'Costume Champ',
    description: 'Won or placed in the costume contest.',
    sortOrder: 10,
    criteria: { type: 'manual' },
  },
  {
    id: 'volunteer',
    title: 'Volunteer',
    description: 'Volunteered at a show.',
    sortOrder: 11,
    criteria: { type: 'manual' },
  },
  {
    id: 'level-10',
    title: 'Level 10',
    description: 'Reached Level 10.',
    sortOrder: 12,
    criteria: { type: 'level', level: 10 },
  },
  {
    id: 'regular',
    title: 'Regular',
    description: 'Checked in to five shows.',
    sortOrder: 13,
    criteria: { type: 'checkins', count: 5 },
  },
];

export interface BadgeContext {
  xp: number;
  checkins: number;
  /** Badge ids already awarded. */
  earned: ReadonlySet<string>;
  levels?: readonly Level[];
  badges?: readonly Badge[];
}

/**
 * Which badges become earned by automatic criteria given the current totals.
 * `manual` and `challenge` badges are awarded by staff actions, never here.
 */
export function badgesFor(ctx: BadgeContext): string[] {
  const level = levelFromXp(ctx.xp, ctx.levels ?? DEFAULT_LEVELS).level;
  const out: string[] = [];
  for (const b of ctx.badges ?? DEFAULT_BADGES) {
    if (ctx.earned.has(b.id)) continue;
    const c = b.criteria;
    const hit =
      (c.type === 'first_checkin' && ctx.checkins >= 1) ||
      (c.type === 'checkins' && ctx.checkins >= c.count) ||
      (c.type === 'level' && level >= c.level);
    if (hit) out.push(b.id);
  }
  return out;
}
