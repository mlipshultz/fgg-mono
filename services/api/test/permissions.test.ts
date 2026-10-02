import { describe, expect, it } from 'vitest';
import { assignableRoles, can, require as requireCan } from '../src/lib/permissions.js';
import { rolesFromGroups } from '../src/lib/auth.js';

const SUB = '2f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d';
const OTHER = '3f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d';

describe('can', () => {
  it('lets any signed-in user read and update only their own data', () => {
    const me = { sub: SUB, roles: ['attendee' as const] };
    expect(can(me, 'read_own', SUB)).toBe(true);
    expect(can(me, 'read_own', OTHER)).toBe(false);
    expect(can(me, 'save_events', SUB)).toBe(true);
  });
  it('treats a user with no group yet as an attendee', () => {
    expect(can({ sub: SUB, roles: [] }, 'read_own', SUB)).toBe(true);
    expect(can({ sub: SUB, roles: [] }, 'admin_read_users')).toBe(false);
  });
  it('gates booking, staff and superadmin actions by role', () => {
    expect(can({ sub: SUB, roles: ['vendor_applicant'] }, 'book_tables')).toBe(false);
    expect(can({ sub: SUB, roles: ['vendor'] }, 'book_tables')).toBe(true);
    expect(can({ sub: SUB, roles: ['staff'] }, 'admin_read_users')).toBe(true);
    expect(can({ sub: SUB, roles: ['staff'] }, 'admin_set_roles')).toBe(false);
    expect(can({ sub: SUB, roles: ['superadmin'] }, 'admin_set_roles')).toBe(true);
    expect(() => requireCan({ sub: SUB, roles: ['attendee'] }, 'manage_events')).toThrow();
  });
});

describe('assignableRoles', () => {
  it('only superadmin assigns, and never demotes itself', () => {
    const admin = { sub: SUB, roles: ['superadmin' as const] };
    expect(assignableRoles(admin, OTHER, ['staff', 'staff'])).toEqual(['staff']);
    expect(() => assignableRoles(admin, SUB, ['staff'])).toThrow(/own superadmin/);
    expect(() => assignableRoles({ sub: SUB, roles: ['staff'] }, OTHER, ['vendor'])).toThrow();
  });
});

describe('rolesFromGroups', () => {
  it('accepts arrays, bracketed strings and comma lists, dropping unknown groups', () => {
    expect(rolesFromGroups(['staff', 'nope'])).toEqual(['staff']);
    expect(rolesFromGroups('[attendee vendor]')).toEqual(['attendee', 'vendor']);
    expect(rolesFromGroups('staff,superadmin')).toEqual(['staff', 'superadmin']);
    expect(rolesFromGroups(undefined)).toEqual([]);
  });
});
