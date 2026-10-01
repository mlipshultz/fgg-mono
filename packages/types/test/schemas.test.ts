import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, Order, Ulid, VendorApplicationInput, FloorTable } from '../src/index.js';

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

  it('requires both agreements on a vendor application', () => {
    const base = {
      businessName: 'Card Shop',
      contactName: 'Sam',
      email: 'sam@example.com',
      phone: '4105551234',
      sells: ['pokemon_cards'],
      codeOfConductAccepted: true,
      sealedPolicyAccepted: true,
    };
    expect(VendorApplicationInput.safeParse(base).success).toBe(true);
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
