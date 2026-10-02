import { z } from 'zod';
import { CognitoSub, Email, IsoDateTime, Ulid } from './common.js';

export const SellsCategory = z.enum([
  'pokemon_cards',
  'other_tcg',
  'video_games',
  'collectibles',
  'art',
  'apparel',
  'accessories',
  'food',
  'other',
]);
export type SellsCategory = z.infer<typeof SellsCategory>;

export const SocialHandles = z.object({
  instagram: z.string().max(60).optional(),
  tiktok: z.string().max(60).optional(),
  website: z.string().url().optional(),
});
export type SocialHandles = z.infer<typeof SocialHandles>;

/** Marketing attribution captured on the application (carried over from the live site). */
export const Attribution = z.object({
  utmSource: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(100).optional(),
  utmContent: z.string().max(100).optional(),
  adName: z.string().max(200).optional(),
  referrer: z.string().max(500).optional(),
  landingPath: z.string().max(300).optional(),
});
export type Attribution = z.infer<typeof Attribution>;

export const VendorApplicationStatus = z.enum([
  'submitted',
  'call_scheduled',
  'approved',
  'rejected',
]);
export type VendorApplicationStatus = z.infer<typeof VendorApplicationStatus>;

/** How approvals happen. A Settings switch; both paths call the same approve(). */
export const VendorApprovalMode = z.enum(['manual_call', 'auto_video_terms']);
export type VendorApprovalMode = z.infer<typeof VendorApprovalMode>;

/** What the form collects. Contact name and email come from the signed-in account. */
export const VendorApplicationInput = z.object({
  businessName: z.string().min(1).max(120),
  phone: z.string().min(7).max(30),
  /** Required free text: what they plan to bring to the table. Staff read this before the call. */
  sellsDescription: z.string().trim().min(1).max(1000),
  /** Categories are not asked on the form any more; set for imported legacy vendors. */
  sells: z.array(SellsCategory).optional(),
  socials: SocialHandles.default({}),
  pokeBucksInterest: z.boolean().default(false),
  codeOfConductAccepted: z.literal(true),
  sealedPolicyAccepted: z.literal(true),
  attribution: Attribution.default({}),
});
export type VendorApplicationInput = z.infer<typeof VendorApplicationInput>;

export const VendorApplication = VendorApplicationInput.extend({
  id: Ulid,
  /** From the account at submit time. */
  contactName: z.string().min(1).max(120),
  email: Email,
  /** Older rows (and imported legacy vendors) have no description. */
  sellsDescription: z.string().max(1000).default(''),
  sells: z.array(SellsCategory).default([]),
  userId: CognitoSub,
  status: VendorApplicationStatus,
  /** Evidence captured regardless of approval mode, so the mode can be switched later. */
  videoWatchedAt: IsoDateTime.optional(),
  termsAcceptedAt: IsoDateTime.optional(),
  callScheduledAt: IsoDateTime.optional(),
  callScheduledVia: z.enum(['calendly_webhook', 'staff']).optional(),
  reviewedBy: z.union([CognitoSub, z.literal('system')]).optional(),
  reviewedAt: IsoDateTime.optional(),
  reviewNotes: z.string().max(2000).optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type VendorApplication = z.infer<typeof VendorApplication>;

export const VendorStatus = z.enum(['active', 'suspended']);
export type VendorStatus = z.infer<typeof VendorStatus>;

/** A vendor is a business. Users attach to it as members. */
export const Vendor = z.object({
  id: Ulid,
  businessName: z.string().min(1).max(120),
  contactName: z.string().min(1).max(120),
  email: Email,
  phone: z.string().min(7).max(30),
  sells: z.array(SellsCategory),
  sellsDescription: z.string().max(1000).default(''),
  socials: SocialHandles,
  /** Brand image in the media bucket under `vendors/{id}/`. Resolved to a URL in API views. */
  logoKey: z.string().max(200).optional(),
  pokeBucksPartner: z.boolean(),
  status: VendorStatus,
  shopifyCustomerId: z.string().optional(),
  approvedFromApplicationId: Ulid.optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Vendor = z.infer<typeof Vendor>;

export const VendorMember = z.object({
  vendorId: Ulid,
  userId: CognitoSub,
  role: z.enum(['owner', 'member']),
  addedBy: CognitoSub,
  addedAt: IsoDateTime,
});
export type VendorMember = z.infer<typeof VendorMember>;

/** PATCH /vendor/profile — the parts of a vendor its members can edit. Contact name and
 *  email track the account and are not editable here. */
export const VendorProfileInput = z
  .object({
    businessName: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(7).max(30),
    sellsDescription: z.string().trim().min(1).max(1000),
    socials: SocialHandles,
    /** Key returned by POST /vendor/profile/logo-upload once the browser has PUT the file. */
    logoKey: z.string().max(200),
  })
  .partial();
export type VendorProfileInput = z.infer<typeof VendorProfileInput>;

export const LogoContentType = z.enum(['image/png', 'image/jpeg', 'image/webp']);
export type LogoContentType = z.infer<typeof LogoContentType>;

/** POST /vendor/profile/logo-upload */
export const LogoUploadInput = z.object({ contentType: LogoContentType });
export type LogoUploadInput = z.infer<typeof LogoUploadInput>;
export const LogoUploadResponse = z.object({
  /** Presigned S3 PUT; send the file with the same content-type. */
  uploadUrl: z.string().url(),
  key: z.string(),
  /** Where it will be served from once uploaded and saved on the profile. */
  logoUrl: z.string().url(),
});
export type LogoUploadResponse = z.infer<typeof LogoUploadResponse>;
