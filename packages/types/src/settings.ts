import { z } from 'zod';
import { VendorApprovalMode } from './vendor.js';

/** Runtime-configurable settings (CONFIG/SETTINGS). Defaults match the handoff decisions. */
export const Settings = z.object({
  processingFeePct: z.number().min(0).max(100).default(0),
  taxPct: z.number().min(0).max(100).default(0),
  holdMinutes: z.number().int().positive().default(10),
  checkoutHoldMinutes: z.number().int().positive().default(30),
  maxTablesPerVendorPerEvent: z.number().int().positive().optional(),
  pokeBucksPartnerCap: z.number().int().positive().optional(),
  refundCutoffDays: z.number().int().nonnegative().default(14),
  vendorApprovalMode: VendorApprovalMode.default('manual_call'),
  calendlyUrl: z.string().url().optional(),
  vendorVideoUrl: z.string().url().optional(),
  discordInviteUrl: z.string().url().optional(),
  contactEmail: z.string().email().optional(),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = Settings.parse({});
