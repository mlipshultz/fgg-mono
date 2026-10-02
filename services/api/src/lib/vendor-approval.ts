import { ulid } from 'ulid';
import type { Role, User, Vendor, VendorApplication, VendorMember } from '@fgg/types';
import { addToGroup, removeFromGroup } from './cognito.js';
import { getUser, putVendor, putVendorApplication, putVendorMember, updateUser } from './db.js';
import { HttpError } from './http.js';

/**
 * The ONE approval path (docs/PLAN.md §3.5a): used by staff review and by the automatic
 * video+terms mode. Creates the vendor, attaches the applicant as owner, flips roles.
 */
export async function approve(
  application: VendorApplication,
  reviewedBy: string | 'system',
  notes?: string,
): Promise<{ vendor: Vendor; application: VendorApplication }> {
  if (application.status === 'approved') {
    throw new HttpError(409, 'already_approved', 'This application is already approved');
  }
  const now = new Date().toISOString();
  const vendor: Vendor = {
    id: ulid(),
    businessName: application.businessName,
    contactName: application.contactName,
    email: application.email,
    phone: application.phone,
    sells: application.sells,
    socials: application.socials,
    pokeBucksPartner: application.pokeBucksInterest,
    status: 'active',
    approvedFromApplicationId: application.id,
    createdAt: now,
    updatedAt: now,
  };
  const member: VendorMember = {
    vendorId: vendor.id,
    userId: application.userId,
    role: 'owner',
    addedBy: reviewedBy,
    addedAt: now,
  };
  await putVendor(vendor);
  await putVendorMember(member);
  const updated: VendorApplication = {
    ...application,
    status: 'approved',
    reviewedBy,
    reviewedAt: now,
    ...(notes ? { reviewNotes: notes } : {}),
    updatedAt: now,
  };
  await putVendorApplication(updated);
  await setRoles(application.userId, vendor.id, (roles) => [
    ...new Set([...roles.filter((r) => r !== 'vendor_applicant'), 'vendor' as Role]),
  ]);
  await addToGroup(application.userId, 'vendor');
  await removeFromGroup(application.userId, 'vendor_applicant');
  console.info(`vendor approved: ${vendor.businessName} (${vendor.id}) by ${reviewedBy}`);
  // Email: deferred until an SES identity exists.
  return { vendor, application: updated };
}

export async function reject(
  application: VendorApplication,
  reviewedBy: string,
  notes?: string,
): Promise<VendorApplication> {
  if (application.status === 'approved') {
    throw new HttpError(
      409,
      'already_approved',
      'Approved applications cannot be rejected; suspend the vendor instead',
    );
  }
  const now = new Date().toISOString();
  const updated: VendorApplication = {
    ...application,
    status: 'rejected',
    reviewedBy,
    reviewedAt: now,
    ...(notes ? { reviewNotes: notes } : {}),
    updatedAt: now,
  };
  await putVendorApplication(updated);
  await setRoles(application.userId, undefined, (roles) =>
    roles.filter((r) => r !== 'vendor_applicant'),
  );
  await removeFromGroup(application.userId, 'vendor_applicant');
  return updated;
}

async function setRoles(
  sub: string,
  vendorId: string | undefined,
  fn: (roles: Role[]) => Role[],
): Promise<User | undefined> {
  const u = await getUser(sub);
  if (!u) return undefined;
  return updateUser(sub, { roles: fn(u.roles), ...(vendorId ? { vendorId } : {}) });
}
