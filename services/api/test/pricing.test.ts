import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@fgg/types';
import { nearbyText, resolveQuote } from '../src/lib/pricing.js';
import { event, floorPlan } from './fixtures.js';

const base = { event, floorPlan, settings: DEFAULT_SETTINGS };

describe('resolveQuote', () => {
  it('multiplies the base rate by the number of days with no fee or tax', () => {
    const q = resolveQuote({
      ...base,
      tableId: 'A1',
      dates: ['2026-10-25', '2026-10-24'],
      rate: 'standard',
    });
    expect(q).toMatchObject({
      unitCents: 20000,
      amountCents: 40000,
      feeCents: 0,
      taxCents: 0,
      totalCents: 40000,
    });
    expect(q.dates).toEqual(['2026-10-24', '2026-10-25']);
    expect(q.rowLabel).toBe('Row A · Main Hall');
  });

  it('uses the PokéBucks rate and an active price window', () => {
    const win = {
      id: '01HZX3V9K7Q2M4N8P6R5T1W0YC',
      kind: 'early_bird' as const,
      startsAt: '2026-01-01T00:00:00Z',
      endsAt: '2026-06-01T00:00:00Z',
      tableRateCents: 15000,
      pokeBucksRateCents: 7500,
    };
    const inWindow = resolveQuote({
      ...base,
      priceWindows: [win],
      tableId: 'A1',
      dates: ['2026-10-24'],
      rate: 'poke_bucks',
      now: new Date('2026-03-01T00:00:00Z'),
    });
    expect(inWindow.unitCents).toBe(7500);
    expect(inWindow.pricingInputs.priceWindowKind).toBe('early_bird');
    const after = resolveQuote({
      ...base,
      priceWindows: [win],
      tableId: 'A1',
      dates: ['2026-10-24'],
      rate: 'poke_bucks',
      now: new Date('2026-09-01T00:00:00Z'),
    });
    expect(after.unitCents).toBe(10000);
    expect(after.pricingInputs.priceWindowId).toBeUndefined();
  });

  it('applies premium deltas and absolute overrides, and configured fee/tax', () => {
    const plan = {
      ...floorPlan,
      tables: floorPlan.tables.map((t) =>
        t.id === 'A1'
          ? { ...t, premiumDeltaCents: 5000 }
          : t.id === 'A2'
            ? { ...t, priceOverrideCents: 30000 }
            : t,
      ),
    };
    const settings = { ...DEFAULT_SETTINGS, processingFeePct: 3, taxPct: 6 };
    const delta = resolveQuote({
      ...base,
      floorPlan: plan,
      settings,
      tableId: 'A1',
      dates: ['2026-10-24'],
      rate: 'standard',
    });
    expect(delta.unitCents).toBe(25000);
    expect(delta.feeCents).toBe(750);
    expect(delta.taxCents).toBe(1500);
    expect(delta.totalCents).toBe(27250);
    const override = resolveQuote({
      ...base,
      floorPlan: plan,
      settings,
      tableId: 'A2',
      dates: ['2026-10-24'],
      rate: 'poke_bucks',
    });
    expect(override.unitCents).toBe(30000);
  });

  it('rejects unknown tables and dates outside the event', () => {
    expect(() =>
      resolveQuote({ ...base, tableId: 'Z9', dates: ['2026-10-24'], rate: 'standard' }),
    ).toThrow(/not on the floor plan/);
    expect(() =>
      resolveQuote({ ...base, tableId: 'A1', dates: ['2026-11-01'], rate: 'standard' }),
    ).toThrow(/not a day/);
  });

  it('describes nearby zones from the canvas rules when no zones are mapped', () => {
    expect(nearbyText(floorPlan.tables[0]!, floorPlan)).toBe(
      'Right by the stage and tournaments, next to the Art Station.',
    );
  });
});
