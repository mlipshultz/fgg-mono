import {
  AdminOrderList,
  AdminUserList,
  AdminUserRow,
  type CancelRequestInput,
  CheckoutResponse,
  type CompOrderInput,
  type ContactSubmissionInput,
  Dashboard,
  EventAvailability,
  EventFloorPlan,
  EventVendorList,
  GalleryPage,
  HoldResponse,
  HomeContent,
  type LogoContentType,
  LogoUploadResponse,
  Me,
  Quote,
  type QuoteInput,
  type ReviewInput,
  type Role,
  SavedEventIds,
  type SubscribeInput,
  type UpdateMeInput,
  VendorApplication,
  type VendorApplicationInput,
  VendorApplicationList,
  type VendorApplicationStatus,
  VendorDashboard,
  type VendorInfoInput,
  VendorOrder,
  VendorOrderList,
  VendorProfile,
  type VendorProfileInput,
  VendorStanding,
  type WaitlistInput,
} from '@fgg/types';
import { homeFixture } from './fixtures/home';
import { galleryFixture } from './fixtures/gallery';
import { adminUsersFixture, dashboardFixture } from './fixtures/dashboard';
import {
  adminOrdersFixture,
  applicationsFixture,
  eventVendorsFixture,
  floorPlanResponseFixture,
  holdFixture,
  paidOrderFixture,
  quoteFixture,
  standingFixture,
  vendorDashboardFixture,
  vendorProfileFixture,
} from './fixtures/booking';
import { getIdToken } from './auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? '';

/** Fixture media uses an absolute placeholder origin (the schema requires URLs); serve it from /public. */
const FIXTURE_ORIGIN = 'https://fixture.local';
function localize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).split(FIXTURE_ORIGIN).join('')) as T;
}

export const hasApi = API_URL.length > 0;

const fake = <T>(value: T, ms = 400) => new Promise<T>((r) => setTimeout(() => r(value), ms));

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: { message?: string; code?: string } };
      if (body.error?.message) message = body.error.message;
      code = body.error?.code;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Same as request(), with the Cognito ID token attached. Throws ApiError(401) when signed out. */
async function authedRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getIdToken();
  if (!token) throw new ApiError('Please log in', 401, 'unauthorized');
  return request<T>(path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
}

/** Build-time: everything the homepage needs. Falls back to the fixture without an API. */
export async function getHomeContent(): Promise<HomeContent> {
  if (!hasApi) return localize(homeFixture);
  const data = await request<unknown>('/public/home', { cache: 'force-cache' });
  return HomeContent.parse(data);
}

/** Build-time: first gallery page. Falls back to the fixture without an API. */
export async function getGalleryPage(): Promise<GalleryPage> {
  if (!hasApi) return localize(galleryFixture);
  const data = await request<unknown>('/public/gallery?limit=12', { cache: 'force-cache' });
  return GalleryPage.parse(data);
}

export interface GalleryQuery {
  eventId?: string;
  videosOnly?: boolean;
  cursor?: string;
  limit?: number;
}

export async function fetchGallery(q: GalleryQuery): Promise<GalleryPage> {
  if (!hasApi) {
    let items = galleryFixture.items;
    if (q.eventId) items = items.filter((i) => i.eventId === q.eventId);
    if (q.videosOnly) items = items.filter((i) => i.type === 'video');
    return fake(localize({ ...galleryFixture, items, nextCursor: undefined }));
  }
  const params = new URLSearchParams();
  if (q.eventId) params.set('eventId', q.eventId);
  if (q.videosOnly) params.set('videosOnly', 'true');
  if (q.cursor) params.set('cursor', q.cursor);
  if (q.limit) params.set('limit', String(q.limit));
  const data = await request<unknown>(`/public/gallery?${params.toString()}`);
  return GalleryPage.parse(data);
}

export async function fetchAvailability(eventId: string): Promise<EventAvailability | null> {
  if (!hasApi) return null;
  try {
    const data = await request<unknown>(
      `/public/events/${encodeURIComponent(eventId)}/availability`,
    );
    return EventAvailability.parse(data);
  } catch {
    return null;
  }
}

export async function subscribe(input: SubscribeInput): Promise<void> {
  if (!hasApi) return fake(undefined);
  await request('/public/subscribe', { method: 'POST', body: JSON.stringify(input) });
}

export async function sendContact(input: ContactSubmissionInput): Promise<void> {
  if (!hasApi) return fake(undefined);
  await request('/public/contact', { method: 'POST', body: JSON.stringify(input) });
}

export async function joinWaitlist(eventId: string, input: WaitlistInput): Promise<void> {
  if (!hasApi) return fake(undefined);
  await request(`/public/events/${encodeURIComponent(eventId)}/waitlist`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// Account API (authenticated). Fixtures when there is no API.
// ---------------------------------------------------------------------------

export async function getMe(): Promise<Me> {
  if (!hasApi) return fake(dashboardFixture.me);
  return Me.parse(await authedRequest<unknown>('/me'));
}

export async function updateMe(input: UpdateMeInput): Promise<Me> {
  if (!hasApi) return fake({ ...dashboardFixture.me, ...input });
  return Me.parse(
    await authedRequest<unknown>('/me', { method: 'PATCH', body: JSON.stringify(input) }),
  );
}

export async function getDashboard(): Promise<Dashboard> {
  if (!hasApi) return fake(localize(dashboardFixture));
  return Dashboard.parse(await authedRequest<unknown>('/me/dashboard'));
}

export async function getSavedEventIds(): Promise<SavedEventIds> {
  if (!hasApi) return fake({ eventIds: dashboardFixture.savedEvents.map((e) => e.id) }, 100);
  return SavedEventIds.parse(await authedRequest<unknown>('/me/saved'));
}

export async function saveEvent(eventId: string): Promise<void> {
  if (!hasApi) return fake(undefined, 150);
  await authedRequest(`/me/saved/${encodeURIComponent(eventId)}`, { method: 'PUT' });
}

export async function unsaveEvent(eventId: string): Promise<void> {
  if (!hasApi) return fake(undefined, 150);
  await authedRequest(`/me/saved/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
}

export async function adminListUsers(q?: {
  cursor?: string;
  email?: string;
}): Promise<AdminUserList> {
  if (!hasApi) {
    const email = q?.email?.toLowerCase();
    const items = email ? adminUsersFixture.filter((u) => u.email === email) : adminUsersFixture;
    return fake({ items });
  }
  const params = new URLSearchParams();
  if (q?.cursor) params.set('cursor', q.cursor);
  if (q?.email) params.set('q', q.email);
  const qs = params.toString();
  return AdminUserList.parse(await authedRequest<unknown>(`/admin/users${qs ? `?${qs}` : ''}`));
}

export async function adminSetRoles(sub: string, roles: Role[]): Promise<AdminUserRow> {
  if (!hasApi) {
    const row = adminUsersFixture.find((u) => u.sub === sub) ?? adminUsersFixture[0]!;
    return fake({ ...row, roles });
  }
  return AdminUserRow.parse(
    await authedRequest<unknown>(`/admin/users/${encodeURIComponent(sub)}/roles`, {
      method: 'PUT',
      body: JSON.stringify({ roles }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Vendor application + booking (Phase 3). Fixtures when there is no API.
// ---------------------------------------------------------------------------

/** Public: floor plan + live availability for the picker. */
export async function getEventFloorPlan(idOrSlug: string): Promise<EventFloorPlan> {
  if (!hasApi) return fake(localize(floorPlanResponseFixture), 300);
  return EventFloorPlan.parse(
    await request<unknown>(`/public/events/${encodeURIComponent(idOrSlug)}/floorplan`),
  );
}

export async function getVendorStanding(): Promise<VendorStanding> {
  if (!hasApi) return fake(standingFixture);
  return VendorStanding.parse(await authedRequest<unknown>('/me/vendor-application'));
}

export async function submitVendorApplication(
  input: VendorApplicationInput,
): Promise<VendorApplication> {
  if (!hasApi) return fake({ ...applicationsFixture[0]!, ...input, status: 'submitted' as const });
  return VendorApplication.parse(
    await authedRequest<unknown>('/me/vendor-application', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
}

export async function getQuote(eventId: string, input: QuoteInput): Promise<Quote> {
  if (!hasApi) return fake(quoteFixture(input.lines, input.rate), 150);
  return Quote.parse(
    await authedRequest<unknown>(`/vendor/events/${encodeURIComponent(eventId)}/quote`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
}

/** Fixture mode keeps the last hold so info/checkout steps see what was actually picked. */
let fixtureHold: HoldResponse | null = null;

export async function createHold(eventId: string, input: QuoteInput): Promise<HoldResponse> {
  if (!hasApi) {
    fixtureHold = localize(holdFixture(input.lines, input.rate));
    return fake(fixtureHold);
  }
  return HoldResponse.parse(
    await authedRequest<unknown>(`/vendor/events/${encodeURIComponent(eventId)}/holds`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
}

const DEFAULT_FIXTURE_HOLD = () =>
  localize(holdFixture([{ tableId: 'C4', dates: ['2026-10-24', '2026-10-25'] }], 'standard'));

export async function getHold(holdId: string): Promise<HoldResponse> {
  if (!hasApi) return fake(fixtureHold ?? DEFAULT_FIXTURE_HOLD());
  return HoldResponse.parse(
    await authedRequest<unknown>(`/vendor/holds/${encodeURIComponent(holdId)}`),
  );
}

export async function updateHold(
  holdId: string,
  vendorInfo: VendorInfoInput,
): Promise<HoldResponse> {
  if (!hasApi) {
    const h = fixtureHold ?? DEFAULT_FIXTURE_HOLD();
    fixtureHold = {
      ...h,
      vendorInfo: { ...vendorInfo, contactName: 'Maya Johnson', email: 'maya@cardcorner.com' },
    };
    return fake(fixtureHold);
  }
  return HoldResponse.parse(
    await authedRequest<unknown>(`/vendor/holds/${encodeURIComponent(holdId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ vendorInfo }),
    }),
  );
}

export async function releaseHold(holdId: string): Promise<void> {
  if (!hasApi) return fake(undefined, 150);
  await authedRequest(`/vendor/holds/${encodeURIComponent(holdId)}`, { method: 'DELETE' });
}

export async function checkout(holdId: string): Promise<CheckoutResponse> {
  if (!hasApi) {
    return fake({
      orderId: paidOrderFixture.id,
      invoiceUrl: `${window.location.origin}/vendor/orders/done/?id=${paidOrderFixture.id}&preview=1`,
      holdExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
  }
  return CheckoutResponse.parse(
    await authedRequest<unknown>(`/vendor/holds/${encodeURIComponent(holdId)}/checkout`, {
      method: 'POST',
    }),
  );
}

export async function listVendorOrders(): Promise<VendorOrderList> {
  if (!hasApi) return fake(localize({ orders: vendorDashboardFixture.history }));
  return VendorOrderList.parse(await authedRequest<unknown>('/vendor/orders'));
}

export async function getVendorOrder(orderId: string): Promise<VendorOrder> {
  if (!hasApi) {
    const found = vendorDashboardFixture.history.find((o) => o.id === orderId);
    return fake(localize(found ?? paidOrderFixture), 300);
  }
  return VendorOrder.parse(
    await authedRequest<unknown>(`/vendor/orders/${encodeURIComponent(orderId)}`),
  );
}

export async function requestCancel(
  orderId: string,
  input: CancelRequestInput,
): Promise<VendorOrder> {
  if (!hasApi) {
    return fake({
      ...localize(paidOrderFixture),
      id: orderId,
      cancelRequestedAt: new Date().toISOString(),
    });
  }
  return VendorOrder.parse(
    await authedRequest<unknown>(`/vendor/orders/${encodeURIComponent(orderId)}/cancel-request`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
}

export async function getVendorDashboard(): Promise<VendorDashboard> {
  if (!hasApi) return fake(localize(vendorDashboardFixture));
  return VendorDashboard.parse(await authedRequest<unknown>('/vendor/dashboard'));
}

/** Public: who has a paid table at an event. Fetched at runtime so it stays fresh. */
export async function getEventVendors(idOrSlug: string): Promise<EventVendorList> {
  if (!hasApi) return fake(localize(eventVendorsFixture));
  return EventVendorList.parse(
    await request<unknown>(`/public/events/${encodeURIComponent(idOrSlug)}/vendors`),
  );
}

// Vendor profile (business details + brand logo).

let fixtureProfile: VendorProfile = vendorProfileFixture;
let fixtureLogoUrl: string | undefined;

export async function getVendorProfile(): Promise<VendorProfile> {
  if (!hasApi) return fake(localize(fixtureProfile));
  return VendorProfile.parse(await authedRequest<unknown>('/vendor/profile'));
}

export async function updateVendorProfile(input: VendorProfileInput): Promise<VendorProfile> {
  if (!hasApi) {
    fixtureProfile = {
      ...fixtureProfile,
      ...input,
      ...(input.logoKey && fixtureLogoUrl ? { logoUrl: fixtureLogoUrl } : {}),
    };
    return fake(localize(fixtureProfile));
  }
  return VendorProfile.parse(
    await authedRequest<unknown>('/vendor/profile', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  );
}

/** Presign, PUT the file straight to S3, and hand back the key to save on the profile. */
export async function uploadVendorLogo(
  blob: Blob,
  contentType: LogoContentType,
): Promise<{ key: string; logoUrl: string }> {
  if (!hasApi) {
    fixtureLogoUrl = URL.createObjectURL(blob);
    return fake({ key: 'vendors/fixture/logo-new.webp', logoUrl: fixtureLogoUrl });
  }
  const up = LogoUploadResponse.parse(
    await authedRequest<unknown>('/vendor/profile/logo-upload', {
      method: 'POST',
      body: JSON.stringify({ contentType }),
    }),
  );
  const res = await fetch(up.uploadUrl, {
    method: 'PUT',
    body: blob,
    headers: { 'content-type': contentType },
  });
  if (!res.ok) throw new ApiError(`Upload failed (${res.status})`, res.status);
  return { key: up.key, logoUrl: up.logoUrl };
}

/** Fetch an authenticated file and hand it to the browser as a download. */
export async function downloadVendorFile(
  orderId: string,
  kind: 'pass.ics' | 'receipt.pdf',
  filename: string,
): Promise<void> {
  if (!hasApi) {
    const body =
      kind === 'pass.ics'
        ? 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//FGG//fixture//EN\r\nEND:VCALENDAR\r\n'
        : '%PDF-1.4 fixture';
    const type = kind === 'pass.ics' ? 'text/calendar' : 'application/pdf';
    triggerDownload(new Blob([body], { type }), filename);
    return;
  }
  const token = await getIdToken();
  if (!token) throw new ApiError('Please log in', 401, 'unauthorized');
  const res = await fetch(`${API_URL}/vendor/orders/${encodeURIComponent(orderId)}/${kind}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new ApiError(`Download failed (${res.status})`, res.status);
  triggerDownload(await res.blob(), filename);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Admin: applications and orders.

export async function adminListApplications(q?: {
  status?: VendorApplicationStatus;
  cursor?: string;
}): Promise<VendorApplicationList> {
  if (!hasApi) {
    const items = q?.status
      ? applicationsFixture.filter((a) => a.status === q.status)
      : applicationsFixture;
    return fake({ items });
  }
  const params = new URLSearchParams();
  if (q?.status) params.set('status', q.status);
  if (q?.cursor) params.set('cursor', q.cursor);
  const qs = params.toString();
  return VendorApplicationList.parse(
    await authedRequest<unknown>(`/admin/vendor-applications${qs ? `?${qs}` : ''}`),
  );
}

async function reviewApplication(
  id: string,
  action: 'call-scheduled' | 'approve' | 'reject',
  input: ReviewInput,
): Promise<VendorApplication> {
  if (!hasApi) {
    const app = applicationsFixture.find((a) => a.id === id) ?? applicationsFixture[0]!;
    const status =
      action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'call_scheduled';
    return fake({ ...app, status, ...(input.notes ? { reviewNotes: input.notes } : {}) });
  }
  return VendorApplication.parse(
    await authedRequest<unknown>(`/admin/vendor-applications/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
}
export const adminCallScheduled = (id: string) => reviewApplication(id, 'call-scheduled', {});
export const adminApprove = (id: string, input: ReviewInput) =>
  reviewApplication(id, 'approve', input);
export const adminReject = (id: string, input: ReviewInput) =>
  reviewApplication(id, 'reject', input);

export async function adminListOrders(q?: {
  eventId?: string;
  status?: string;
  cursor?: string;
}): Promise<AdminOrderList> {
  if (!hasApi) {
    let items = adminOrdersFixture.items;
    if (q?.eventId) items = items.filter((o) => o.eventId === q.eventId);
    if (q?.status) items = items.filter((o) => o.status === q.status);
    return fake(localize({ items }));
  }
  const params = new URLSearchParams();
  if (q?.eventId) params.set('eventId', q.eventId);
  if (q?.status) params.set('status', q.status);
  if (q?.cursor) params.set('cursor', q.cursor);
  const qs = params.toString();
  return AdminOrderList.parse(await authedRequest<unknown>(`/admin/orders${qs ? `?${qs}` : ''}`));
}

export async function adminRefund(orderId: string, reason?: string): Promise<VendorOrder> {
  if (!hasApi) {
    const o = adminOrdersFixture.items.find((x) => x.id === orderId) ?? paidOrderFixture;
    return fake(
      localize({ ...o, status: 'refunded' as const, refundedAt: new Date().toISOString() }),
    );
  }
  return VendorOrder.parse(
    await authedRequest<unknown>(`/admin/orders/${encodeURIComponent(orderId)}/refund`, {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    }),
  );
}

export async function adminComp(input: CompOrderInput): Promise<VendorOrder> {
  if (!hasApi) {
    return fake(
      localize({
        ...paidOrderFixture,
        id: `${paidOrderFixture.id.slice(0, 24)}99`,
        source: 'manual' as const,
        totalCents: 0,
        subtotalCents: 0,
        lines: [
          {
            type: 'table' as const,
            tableId: input.tableId,
            dates: input.dates,
            rate: 'standard' as const,
            unitCents: 0,
            lineCents: 0,
          },
        ],
        passNumber: 'HF26-099',
      }),
    );
  }
  return VendorOrder.parse(
    await authedRequest<unknown>('/admin/orders/comp', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
}

export async function adminRegisterWebhooks(): Promise<unknown> {
  if (!hasApi) return fake({ registered: ['ORDERS_PAID', 'REFUNDS_CREATE'], skipped: [] });
  return authedRequest<unknown>('/admin/shopify/register-webhooks', { method: 'POST' });
}
