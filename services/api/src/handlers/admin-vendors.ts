import { ulid } from 'ulid';
import {
  AdminVendorInput,
  LogoUploadInput,
  type AdminVendor,
  type AdminVendorList,
  type LogoUploadResponse,
  type Vendor,
} from '@fgg/types';
import { claimsFrom } from '../lib/auth.js';
import {
  getVendor,
  listOrdersForOwner,
  listVendorMembers,
  listVendors,
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
