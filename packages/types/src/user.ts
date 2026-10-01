import { z } from 'zod';
import { CognitoSub, Email, IsoDateTime } from './common.js';

/** Cognito groups. Checked on every API route via the permissions module. */
export const Role = z.enum(['attendee', 'vendor_applicant', 'vendor', 'staff', 'superadmin']);
export type Role = z.infer<typeof Role>;

export const MINIMUM_AGE = 13;

export const User = z.object({
  sub: CognitoSub,
  email: Email,
  displayName: z.string().min(1).max(60),
  birthYear: z.number().int().min(1900).max(2100),
  roles: z.array(Role),
  /** Vendor this user belongs to, if any (one at launch). */
  vendorId: z.string().optional(),
  memberSince: IsoDateTime,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type User = z.infer<typeof User>;

/** Public shape returned to the client for its own session. */
export const Me = User.pick({
  sub: true,
  email: true,
  displayName: true,
  roles: true,
  vendorId: true,
  memberSince: true,
});
export type Me = z.infer<typeof Me>;
