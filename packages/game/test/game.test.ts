import { describe, expect, it } from 'vitest';
import { LevelProgress } from '@fgg/types';
import { DEFAULT_BADGES, DEFAULT_LEVELS, MAX_LEVEL, badgesFor, levelFromXp } from '../src/index.js';

describe('DEFAULT_LEVELS', () => {
  it('is a ×1.5 curve rounded to 5, starting at 100', () => {
    const xp = DEFAULT_LEVELS.map((l) => l.xpRequired);
    expect(xp.slice(0, 8)).toEqual([0, 100, 250, 475, 815, 1325, 2090, 3240]);
    expect(DEFAULT_LEVELS).toHaveLength(MAX_LEVEL);
    expect(DEFAULT_LEVELS[7]).toMatchObject({
      level: 8,
      title: 'Collector',
      unlocks: 'Early-entry pass + "Collector" title',
    });
  });
});

describe('levelFromXp', () => {
  it('derives level and progress that validate against the API schema', () => {
    const p = levelFromXp(2500);
    expect(LevelProgress.safeParse(p).success).toBe(true);
    expect(p).toMatchObject({
      level: 7,
      title: 'Trader',
      xpIntoLevel: 410,
      xpForLevel: 1150,
      xpToNext: 740,
      nextLevel: 8,
      nextTitle: 'Collector',
    });
    expect(p.pct).toBeCloseTo(410 / 1150, 5);
  });
  it('clamps negatives and handles the top level', () => {
    expect(levelFromXp(-5)).toMatchObject({ level: 1, xp: 0, pct: 0, xpToNext: 100 });
    const top = levelFromXp(10_000_000);
    expect(top.level).toBe(MAX_LEVEL);
    expect(top.pct).toBe(1);
    expect(top.nextLevel).toBeUndefined();
  });
  it('accepts a custom curve', () => {
    const p = levelFromXp(50, [
      { level: 1, title: 'A', xpRequired: 0 },
      { level: 2, title: 'B', xpRequired: 40 },
    ]);
    expect(p).toMatchObject({ level: 2, title: 'B', pct: 1 });
  });
});

describe('badgesFor', () => {
  it('awards automatic badges once and never manual ones', () => {
    expect(badgesFor({ xp: 0, checkins: 0, earned: new Set() })).toEqual([]);
    expect(badgesFor({ xp: 0, checkins: 1, earned: new Set() })).toEqual(['first-fest']);
    expect(badgesFor({ xp: 0, checkins: 1, earned: new Set(['first-fest']) })).toEqual([]);
    const lvl10xp = DEFAULT_LEVELS[9]!.xpRequired;
    expect(badgesFor({ xp: lvl10xp, checkins: 5, earned: new Set(['first-fest']) })).toEqual([
      'level-10',
      'regular',
    ]);
    expect(DEFAULT_BADGES.every((b) => /^[a-z0-9-]+$/.test(b.id))).toBe(true);
  });
});
