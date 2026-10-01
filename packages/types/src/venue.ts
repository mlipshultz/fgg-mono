import { z } from 'zod';
import { Cents, TimeZone, Ulid } from './common.js';

export const Venue = z.object({
  id: Ulid,
  name: z.string().min(1).max(120),
  address: z.string().max(300),
  city: z.string().max(100),
  state: z.string().max(50),
  timeZone: TimeZone.default('America/New_York'),
});
export type Venue = z.infer<typeof Venue>;

/** Named area on the floor plan, used for "Nearby: ..." text and for side-zone tiles. */
export const FloorZone = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  /** Grid placement in floor-plan units (cells). */
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
});
export type FloorZone = z.infer<typeof FloorZone>;

export const FloorTable = z.object({
  /** e.g. "B7". Stable; never renumber a table that has bookings. */
  id: z.string().regex(/^[A-Z]{1,2}\d{1,3}$/),
  row: z.string().regex(/^[A-Z]{1,2}$/),
  position: z.number().int().positive(),
  x: z.number(),
  y: z.number(),
  /** Zone IDs this table is near, drives the "Nearby" text. */
  nearby: z.array(z.string()).default([]),
  /** Premium tables: either an absolute per-day override or a delta on the event rate. */
  priceOverrideCents: Cents.optional(),
  premiumDeltaCents: Cents.optional(),
});
export type FloorTable = z.infer<typeof FloorTable>;

export const FloorPlan = z.object({
  venueId: Ulid,
  version: z.number().int().positive(),
  /** Grid size in cells. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  zones: z.array(FloorZone),
  tables: z.array(FloorTable),
});
export type FloorPlan = z.infer<typeof FloorPlan>;
