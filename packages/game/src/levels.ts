import type { Level, LevelProgress } from '@fgg/types';

/**
 * Placeholder level curve (handoff §0A): each level is ~50% harder than the last,
 * starting at 100 XP and rounded to the nearest 5. Cumulative XP:
 * L1 0 · L2 100 · L3 250 · L4 475 · L5 815 · L6 1325 · L7 2090 · L8 3240 · …
 * Real values drop in by replacing DEFAULT_LEVELS (or the CONFIG/LEVEL# rows).
 */
export const MAX_LEVEL = 15;

function titleFor(level: number): string {
  if (level <= 2) return 'Rookie';
  if (level <= 7) return 'Trader';
  if (level <= 11) return 'Collector';
  if (level <= 14) return 'Champion';
  return 'Legend';
}

const UNLOCKS: Record<number, string> = {
  3: '"Trader" title',
  5: 'Priority raffle entry',
  8: 'Early-entry pass + "Collector" title',
  10: 'Exclusive Level 10 badge',
  12: '"Champion" title + VIP lane at check-in',
  15: '"Legend" title',
};

function buildLevels(): Level[] {
  const levels: Level[] = [];
  let cumulative = 0;
  let span = 100;
  for (let n = 1; n <= MAX_LEVEL; n++) {
    const unlocks = UNLOCKS[n];
    levels.push({
      level: n,
      title: titleFor(n),
      xpRequired: cumulative,
      ...(unlocks ? { unlocks } : {}),
    });
    cumulative += span;
    span = Math.round((span * 1.5) / 5) * 5;
  }
  return levels;
}

export const DEFAULT_LEVELS: readonly Level[] = buildLevels();

/** Derive level, title and progress-into-level from a total XP. Pure. */
export function levelFromXp(xp: number, levels: readonly Level[] = DEFAULT_LEVELS): LevelProgress {
  const total = Math.max(0, Math.floor(xp));
  const sorted = [...levels].sort((a, b) => a.level - b.level);
  if (sorted.length === 0) throw new Error('levelFromXp: no levels configured');
  let current = sorted[0]!;
  let next: Level | undefined;
  for (let i = 0; i < sorted.length; i++) {
    const l = sorted[i]!;
    if (total >= l.xpRequired) {
      current = l;
      next = sorted[i + 1];
    } else break;
  }
  const xpIntoLevel = total - current.xpRequired;
  const xpForLevel = next ? next.xpRequired - current.xpRequired : Math.max(1, xpIntoLevel);
  const xpToNext = next ? Math.max(0, next.xpRequired - total) : 0;
  const pct = next ? Math.min(1, xpIntoLevel / xpForLevel) : 1;
  return {
    level: current.level,
    title: current.title,
    xp: total,
    xpIntoLevel,
    xpForLevel,
    xpToNext,
    pct,
    ...(next ? { nextLevel: next.level, nextTitle: next.title } : {}),
    ...(next?.unlocks ? { nextUnlocks: next.unlocks } : {}),
  };
}
