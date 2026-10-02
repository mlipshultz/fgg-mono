import type { Role } from '@fgg/types';
import { HttpError } from './http.js';

/**
 * The one place role logic lives (docs/PLAN.md §3.3). Every protected handler
 * calls `can()` or `require()`; UI hiding is never the control.
 */
export type Action =
  | 'read_own'
  | 'update_own'
  | 'save_events'
  | 'book_tables'
  | 'view_application_status'
  | 'review_vendor_applications'
  | 'manage_events'
  | 'scan_checkins'
  | 'admin_read_users'
  | 'admin_set_roles'
  | 'admin_refunds'
  | 'admin_settings';

const STAFF: Role[] = ['staff', 'superadmin'];
const SUPER: Role[] = ['superadmin'];
const SIGNED_IN: Role[] = ['attendee', 'vendor_applicant', 'vendor', 'staff', 'superadmin'];

const TABLE: Record<Action, Role[]> = {
  read_own: SIGNED_IN,
  update_own: SIGNED_IN,
  save_events: SIGNED_IN,
  book_tables: ['vendor', 'staff', 'superadmin'],
  view_application_status: ['vendor_applicant', 'vendor', 'staff', 'superadmin'],
  review_vendor_applications: STAFF,
  manage_events: STAFF,
  scan_checkins: STAFF,
  admin_read_users: STAFF,
  admin_set_roles: SUPER,
  admin_refunds: SUPER,
  admin_settings: SUPER,
};

export interface Subject {
  sub: string;
  roles: Role[];
}

export function can(actor: Subject, action: Action, resourceOwnerSub?: string): boolean {
  const allowed = TABLE[action];
  // A signed-in user with no group yet (trigger lag) still owns their own data.
  const effective: Role[] = actor.roles.length ? actor.roles : ['attendee'];
  if (!effective.some((r) => allowed.includes(r))) return false;
  if (action.endsWith('_own') || action === 'save_events') {
    return resourceOwnerSub === undefined || resourceOwnerSub === actor.sub;
  }
  return true;
}

/** Throw 403 unless allowed. */
export function require(actor: Subject, action: Action, resourceOwnerSub?: string): void {
  if (!can(actor, action, resourceOwnerSub)) {
    throw new HttpError(403, 'forbidden', `Not allowed to ${action.replace(/_/g, ' ')}`);
  }
}

/** Roles a given actor may assign. Superadmin only, and it cannot remove its own superadmin. */
export function assignableRoles(actor: Subject, targetSub: string, roles: Role[]): Role[] {
  if (!can(actor, 'admin_set_roles')) throw new HttpError(403, 'forbidden', 'Superadmin only');
  if (targetSub === actor.sub && !roles.includes('superadmin')) {
    throw new HttpError(400, 'cannot_demote_self', 'You cannot remove your own superadmin role');
  }
  return [...new Set(roles)];
}
