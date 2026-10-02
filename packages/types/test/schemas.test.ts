import { describe, it, expect } from 'vitest';
import {
  CognitoSub,
  DEFAULT_SETTINGS,
  Order,
  Ulid,
  VendorApplicationInput,
  FloorTable,
} from '../src/index.js';

describe('schemas', () => {
  it('defaults settings to no fee, no tax, 10 minute holds, manual approval', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      processingFeePct: 0,
      taxPct: 0,
      holdMinutes: 10,
      checkoutHoldMinutes: 30,
      vendorApprovalMode: 'manual_call',
    });
  });

  it('validates ULIDs', () => {
    expect(Ulid.safeParse('01HZX3V9K7Q2M4N8P6R5T1W0YA').success).toBe(true);
    expect(Ulid.safeParse('not-a-ulid').success).toBe(false);
  });

  it('accepts Cognito subs that are not RFC 4122 variant UUIDs', () => {
    // Email user (variant bits valid) and Google-federated user (variant nibble 6) from dev.
    expect(CognitoSub.safeParse('34a80488-d031-70c0-b8b7-f5c27ff25f29').success).toBe(true);
    expect(CognitoSub.safeParse('4458d418-50e1-7095-69b9-90c2e0aa2620').success).toBe(true);
    expect(CognitoSub.safeParse('google_110044957262712945265').success).toBe(false);
  });

  it('requires both agreements on a vendor application', () => {
    const base = {
      businessName: 'Card Shop',
      phone: '4105551234',
      sellsDescription: 'Singles and a bulk bin',
      codeOfConductAccepted: true,
      sealedPolicyAccepted: true,
    };
    expect(VendorApplicationInput.safeParse(base).success).toBe(true);
    expect(VendorApplicationInput.safeParse({ ...base, sellsDescription: ' ' }).success).toBe(
      false,
    );
    expect(VendorApplicationInput.safeParse({ ...base, sealedPolicyAccepted: false }).success).toBe(
      false,
    );
  });

  it('accepts table and ticket lines on one order shape', () => {
    const order = {
      id: '01HZX3V9K7Q2M4N8P6R5T1W0YA',
      eventId: '01HZX3V9K7Q2M4N8P6R5T1W0YB',
      kind: 'vendor_table',
      source: 'shopify',
      ownerId: '01HZX3V9K7Q2M4N8P6R5T1W0YC',
      placedBy: '2f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d',
      status: 'pending_payment',
      lines: [
        {
          type: 'table',
          tableId: 'B7',
          dates: ['2026-10-24', '2026-10-25'],
          rate: 'standard',
          unitCents: 20000,
          lineCents: 40000,
        },
      ],
      subtotalCents: 40000,
      feeCents: 0,
      taxCents: 0,
      totalCents: 40000,
      createdAt: '2026-10-01T12:00:00Z',
      updatedAt: '2026-10-01T12:00:00Z',
    };
    expect(Order.safeParse(order).success).toBe(true);
  });

  it('rejects malformed table ids', () => {
    expect(FloorTable.safeParse({ id: 'b7', row: 'B', position: 7, x: 0, y: 0 }).success).toBe(
      false,
    );
    expect(FloorTable.safeParse({ id: 'B7', row: 'B', position: 7, x: 0, y: 0 }).success).toBe(
      true,
    );
  });
});
