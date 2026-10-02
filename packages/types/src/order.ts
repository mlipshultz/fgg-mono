import { z } from 'zod';
import { Cents, CognitoSub, IsoDate, IsoDateTime, Ulid } from './common.js';

export const TableRate = z.enum(['standard', 'poke_bucks']);
export type TableRate = z.infer<typeof TableRate>;

export const PricingInputs = z.object({
  priceWindowId: Ulid.optional(),
  priceWindowKind: z.string().optional(),
  tableOverrideCents: Cents.optional(),
  premiumDeltaCents: Cents.optional(),
});
export type PricingInputs = z.infer<typeof PricingInputs>;

/** One table within a hold: its days and the price resolved at hold time (never recomputed). */
export const HeldTable = z.object({
  tableId: z.string(),
  dates: z.array(IsoDate).min(1),
  unitCents: Cents,
  amountCents: Cents,
  pricingInputs: PricingInputs,
});
export type HeldTable = z.infer<typeof HeldTable>;

/** A vendor's hold on one or more tables for an event. Stored as one item per table-day. */
export const TableHold = z.object({
  id: Ulid,
  eventId: Ulid,
  vendorId: Ulid,
  heldBy: CognitoSub,
  rate: TableRate,
  tables: z.array(HeldTable).min(1),
  subtotalCents: Cents,
  expiresAt: IsoDateTime,
  createdAt: IsoDateTime,
});
export type TableHold = z.infer<typeof TableHold>;

export const OrderKind = z.enum(['vendor_table', 'ticket']);
export type OrderKind = z.infer<typeof OrderKind>;

export const OrderSource = z.enum(['shopify', 'manual']);
export type OrderSource = z.infer<typeof OrderSource>;

export const OrderStatus = z.enum([
  'pending_payment',
  'paid',
  'refunded',
  'cancelled',
  /** Paid, but the held table was lost before payment landed. Refunded automatically. */
  'conflict',
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const OrderLine = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('table'),
    tableId: z.string(),
    dates: z.array(IsoDate).min(1),
    rate: TableRate,
    unitCents: Cents,
    lineCents: Cents,
  }),
  z.object({
    type: z.literal('ticket'),
    ticketTypeId: Ulid,
    quantity: z.number().int().positive(),
    unitCents: Cents,
    lineCents: Cents,
  }),
]);
export type OrderLine = z.infer<typeof OrderLine>;

export const VendorInfo = z.object({
  tableName: z.string().min(1).max(120),
  contactName: z.string().min(1).max(120),
  phone: z.string().min(7).max(30),
  email: z.string().email(),
  /** What they're bringing; prefilled from the vendor profile. */
  sellsDescription: z.string().trim().min(1).max(1000),
  codeOfConductAccepted: z.literal(true),
});
export type VendorInfo = z.infer<typeof VendorInfo>;

/** What the booking form sends; contact name and email are filled from the account. */
export const VendorInfoInput = VendorInfo.omit({ contactName: true, email: true });
export type VendorInfoInput = z.infer<typeof VendorInfoInput>;

/** Stored orders from before the free-text field have category arrays instead. */
export const StoredVendorInfo = VendorInfo.partial({ sellsDescription: true });
export type StoredVendorInfo = z.infer<typeof StoredVendorInfo>;

export const Order = z.object({
  id: Ulid,
  eventId: Ulid,
  kind: OrderKind,
  source: OrderSource,
  /** Vendor ID for tables, Cognito sub for tickets. */
  ownerId: z.string(),
  placedBy: CognitoSub,
  status: OrderStatus,
  lines: z.array(OrderLine).min(1),
  subtotalCents: Cents,
  feeCents: Cents,
  taxCents: Cents,
  totalCents: Cents,
  vendorInfo: StoredVendorInfo.optional(),
  holdId: Ulid.optional(),
  shopifyDraftOrderId: z.string().optional(),
  shopifyOrderId: z.string().optional(),
  shopifyInvoiceUrl: z.string().url().optional(),
  /** Sequential per event, e.g. HF26-017. */
  passNumber: z.string().optional(),
  checkedInAt: IsoDateTime.optional(),
  paidAt: IsoDateTime.optional(),
  refundedAt: IsoDateTime.optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Order = z.infer<typeof Order>;

export const OrderHistoryEntry = z.object({
  orderId: Ulid,
  at: IsoDateTime,
  from: OrderStatus.optional(),
  to: OrderStatus,
  by: z.union([CognitoSub, z.literal('system'), z.literal('shopify')]),
  note: z.string().max(500).optional(),
});
export type OrderHistoryEntry = z.infer<typeof OrderHistoryEntry>;

export const Ticket = z.object({
  id: Ulid,
  eventId: Ulid,
  orderId: Ulid,
  ticketTypeId: Ulid,
  holderSub: CognitoSub,
  status: z.enum(['valid', 'checked_in', 'void']),
  checkedInAt: IsoDateTime.optional(),
  createdAt: IsoDateTime,
});
export type Ticket = z.infer<typeof Ticket>;
