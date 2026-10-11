import { describe, expect, it } from 'vitest';
import { computeAvailability, fmtTime, hoursLabel } from '../src/lib/events.js';
import { countEvent, event, floorPlan } from './fixtures.js';

describe('hoursLabel', () => {
  it('collapses identical days', () => {
    expect(hoursLabel(event.days)).toBe('11am–5pm');
  });
  it('lists days when hours differ', () => {
    expect(
      hoursLabel([
        { date: '2027-08-06', opens: '10:00', closes: '17:00' },
        { date: '2027-08-07', opens: '10:00', closes: '20:00' },
        { date: '2027-08-08', opens: '10:00', closes: '17:00' },
      ]),
    ).toBe('Fri 10am–5pm · Sat 10am–8pm · Sun 10am–5pm');
  });
  it('formats times', () => {
    expect(fmtTime('00:00')).toBe('12am');
    expect(fmtTime('12:30')).toBe('12:30pm');
  });
});

describe('computeAvailability', () => {
  it('counts distinct tables with at least one open day and ignores unknown table ids', () => {
    const a = computeAvailability(event, floorPlan, [], [{ tableId: 'Z9', date: '2026-10-24' }]);
    expect(a.tablesLeft).toBe(6);
    const b = computeAvailability(
      event,
      floorPlan,
      [],
      [
        { tableId: 'A1', date: '2026-10-24' },
        { tableId: 'A1', date: '2026-10-25' },
        { tableId: 'A2', date: '2026-10-24' },
      ],
    );
    expect(b.tablesLeft).toBe(5);
    expect(b.days[0]!.unavailable).toEqual(['A1', 'A2']);
  });
  it('has zero capacity without a floor plan', () => {
    expect(computeAvailability(event, undefined, [], []).tablesLeft).toBe(0);
  });
  it('counts tables left per day on a quantity event, ignoring expired holds', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const later = new Date(Date.now() + 60_000).toISOString();
    const a = computeAvailability(
      countEvent,
      undefined,
      [
        { quantity: 1, date: '2026-10-24', expiresAt: later },
        { quantity: 2, date: '2026-10-24', expiresAt: past },
      ],
      [
        { quantity: 2, date: '2026-10-24' },
        { quantity: 4, date: '2026-10-25' },
      ],
    );
    expect(a.days).toEqual([
      { date: '2026-10-24', unavailable: [], left: 1 },
      { date: '2026-10-25', unavailable: [], left: 0 },
    ]);
    expect(a.tablesLeft).toBe(1);
  });
});
