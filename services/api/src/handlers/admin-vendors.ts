import { ulid } from 'ulid';
import {
  AddVendorMemberInput,
  AdminVendorInput,
  LogoUploadInput,
  type AdminVendor,
  type AdminVendorList,
  type AdminVendorMember,
  type AdminVendorMemberList,
  type LogoUploadResponse,
  type Role,
  type Vendor,
  type VendorMember,
} from '@fgg/types';
import { claimsFrom } from '../lib/auth.js';
import { addToGroup, removeFromGroup } from '../lib/cognito.js';
import {
  deleteItem,
  getUser,
  getUserByEmail,
  getVendor,
  getVendorForUser,
  keys,
  listOrdersForOwner,
  listVendorMembers,
  listVendors,
  putVendorMember,
  updateUser,
  updateVendor,
} from '../lib/db.js';
import { HttpError, json, parseBody, type Router } from '../lib/http.js';
import { mediaUrl, presignUpload } from '../lib/media.js';
import { require as requireCan } from '../lib/permissions.js';

const LOGO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

async function adminVendor(v: Vendor): Promise<AdminVendor> {
  const [members, orders] = await Promise.all([listVendorMembers(v.id), listOrdersForOwner(v.id)]);
  return {
    ...v,
    ...(v.logoKey ? { logoUrl: mediaUrl(v.logoKey) } : {}),
    memberCount: members.length,
    paidOrderCount: orders.filter((o) => o.status === 'paid').length,
  };
}

/** Members with their account's email and name (a member whose account is gone shows its id). */
async function memberViews(vendorId: string): Promise<AdminVendorMember[]> {
  const members = await listVendorMembers(vendorId);
  const views = await Promise.all(
    members.map(async (m) => {
      const u = await getUser(m.userId);
      return {
        userId: m.userId,
        email: u?.email ?? '',
        displayName: u?.displayName ?? m.userId,
        role: m.role,
        addedAt: m.addedAt,
      };
    }),
  );
  // Owners first, then by when they joined.
  return views.sort(
    (a, b) =>
      (a.role === b.role ? 0 : a.role === 'owner' ? -1 : 1) || a.addedAt.localeCompare(b.addedAt),
  );
}

const withRole = (roles: Role[], role: Role) => [...new Set([...roles, role])];

async function vendorOr404(id: string): Promise<Vendor> {
  const v = await getVendor(id);
  if (!v) throw new HttpError(404, 'vendor_not_found', 'Vendor not found');
  return v;
}

/** Vendors: staff see every vendor and edit one on its behalf (same gate as the applications). */
export function addVendorAdminRoutes(router: Router): void {
  router
    .add('GET', '/admin/vendors', async (req) => {
      requireCan(claimsFrom(req), 'review_vendor_applications');
      const body: AdminVendorList = {
        items: await Promise.all((await listVendors()).map(adminVendor)),
      };
      return json(req, body, 200, { 'cache-control': 'no-store' });
    })
    .add('PATCH', '/admin/vendors/{id}', async (req, { id }) => {
      requireCan(claimsFrom(req), 'review_vendor_applications');
      const vendor = await vendorOr404(id!);
      const input = parseBody(req, AdminVendorInput);
      if (input.logoKey !== undefined && !input.logoKey.startsWith(`vendors/${vendor.id}/`))
        throw new HttpError(400, 'bad_logo_key', 'Logo key does not belong to this vendor');
      const patch = Object.fromEntries(
        Object.entries(input)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, k === 'email' && typeof v === 'string' ? v.toLowerCase() : v]),
      ) as Parameters<typeof updateVendor>[1];
      await updateVendor(vendor.id, patch);
      return json(req, await adminVendor((await getVendor(vendor.id)) ?? { ...vendor, ...patch }));
    })
    .add('GET', '/admin/vendors/{id}/members', async (req, { id }) => {
      requireCan(claimsFrom(req), 'review_vendor_applications');
      const vendor = await vendorOr404(id!);
      const body: AdminVendorMemberList = { items: await memberViews(vendor.id) };
      return json(req, body, 200, { 'cache-control': 'no-store' });
    })
    .add('POST', '/admin/vendors/{id}/members', async (req, { id }) => {
      const actor = claimsFrom(req);
      requireCan(actor, 'review_vendor_applications');
      const vendor = await vendorOr404(id!);
      const { email } = parseBody(req, AddVendorMemberInput);
      const user = await getUserByEmail(email.toLowerCase());
      if (!user)
        throw new HttpError(
          404,
          'no_account',
          `No account uses ${email}. Ask them to sign up on the site first, then add them.`,
        );
      const current = await getVendorForUser(user.sub);
      if (current)
        throw new HttpError(
          409,
          current.id === vendor.id ? 'already_member' : 'other_vendor',
          current.id === vendor.id
            ? `${email} is already a member of ${vendor.businessName}`
            : `${email} already belongs to ${current.businessName}; remove them there first`,
        );
      const member: VendorMember = {
        vendorId: vendor.id,
        userId: user.sub,
        role: 'member',
        addedBy: actor.sub,
        addedAt: new Date().toISOString(),
      };
      await putVendorMember(member);
      await updateUser(user.sub, { roles: withRole(user.roles, 'vendor'), vendorId: vendor.id });
      await addToGroup(user.sub, 'vendor');
      const body: AdminVendorMemberList = { items: await memberViews(vendor.id) };
      return json(req, body, 201);
    })
    .add('DELETE', '/admin/vendors/{id}/members/{sub}', async (req, { id, sub }) => {
      requireCan(claimsFrom(req), 'review_vendor_applications');
      const vendor = await vendorOr404(id!);
      const members = await listVendorMembers(vendor.id);
      if (!members.some((m) => m.userId === sub))
        throw new HttpError(404, 'member_not_found', 'Not a member of this vendor');
      if (members.length === 1)
        throw new HttpError(
          409,
          'last_member',
          'This is the only member; add someone else first so the vendor keeps an account',
        );
      await deleteItem(keys.vendorMember(vendor.id, sub!));
      // One vendor per person: leaving it means leaving the vendor role too.
      const user = await getUser(sub!);
      if (user)
        await updateUser(sub!, { roles: user.roles.filter((r) => r !== 'vendor'), vendorId: null });
      await removeFromGroup(sub!, 'vendor');
      const body: AdminVendorMemberList = { items: await memberViews(vendor.id) };
      return json(req, body);
    })
    .add('POST', '/admin/vendors/{id}/logo-upload', async (req, { id }) => {
      requireCan(claimsFrom(req), 'review_vendor_applications');
      const vendor = await vendorOr404(id!);
      const input = parseBody(req, LogoUploadInput);
      const key = `vendors/${vendor.id}/logo-${ulid().toLowerCase()}.${LOGO_EXT[input.contentType]}`;
      const body: LogoUploadResponse = {
        uploadUrl: await presignUpload(key, input.contentType),
        key,
        logoUrl: mediaUrl(key),
      };
      return json(req, body, 201, { 'cache-control': 'no-store' });
    });
}
