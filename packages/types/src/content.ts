import { z } from 'zod';
import { Email, Ulid } from './common.js';

export const Activity = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(60),
  description: z.string().max(160),
  iconKey: z.string().optional(),
  xp: z.number().int().nonnegative(),
  sortOrder: z.number().int(),
});
export type Activity = z.infer<typeof Activity>;

export const Partner = z.object({
  id: Ulid,
  name: z.string().min(1).max(80),
  logoKey: z.string(),
  url: z.string().url().optional(),
  sortOrder: z.number().int(),
});
export type Partner = z.infer<typeof Partner>;

export const GalleryItem = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('photo'),
    id: Ulid,
    eventId: Ulid,
    mediaKey: z.string(),
    caption: z.string().max(200).optional(),
    featured: z.boolean().default(false),
    sortOrder: z.number().int(),
  }),
  z.object({
    type: z.literal('video'),
    id: Ulid,
    eventId: Ulid,
    mediaKey: z.string(),
    posterKey: z.string(),
    durationSeconds: z.number().int().positive(),
    caption: z.string().max(200).optional(),
    featured: z.boolean().default(false),
    sortOrder: z.number().int(),
  }),
  z.object({
    type: z.literal('stat'),
    id: Ulid,
    eventId: Ulid,
    value: z.string().max(20),
    label: z.string().max(60),
    sortOrder: z.number().int(),
  }),
  z.object({
    type: z.literal('quote'),
    id: Ulid,
    eventId: Ulid,
    text: z.string().max(300),
    attribution: z.string().max(80).optional(),
    sortOrder: z.number().int(),
  }),
]);
export type GalleryItem = z.infer<typeof GalleryItem>;

export const ContactInterest = z.enum([
  'partner',
  'sponsor',
  'volunteer',
  'vendor',
  'press',
  'other',
]);
export type ContactInterest = z.infer<typeof ContactInterest>;

export const ContactSubmissionInput = z.object({
  name: z.string().min(1).max(120),
  organization: z.string().max(120).optional(),
  email: Email,
  interests: z.array(ContactInterest).default([]),
  message: z.string().min(1).max(4000),
});
export type ContactSubmissionInput = z.infer<typeof ContactSubmissionInput>;

export const SubscribeInput = z.object({
  email: Email,
  source: z.string().max(60).default('email_band'),
});
export type SubscribeInput = z.infer<typeof SubscribeInput>;

export const WaitlistInput = z.object({
  email: Email,
  kind: z.enum(['waitlist', 'notify_me']),
});
export type WaitlistInput = z.infer<typeof WaitlistInput>;
