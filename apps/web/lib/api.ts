import {
  AdminUserList,
  AdminUserRow,
  type ContactSubmissionInput,
  Dashboard,
  EventAvailability,
  GalleryPage,
  HomeContent,
  Me,
  type Role,
  SavedEventIds,
  type SubscribeInput,
  type UpdateMeInput,
  type WaitlistInput,
} from '@fgg/types';
import { homeFixture } from './fixtures/home';
import { galleryFixture } from './fixtures/gallery';
import { adminUsersFixture, dashboardFixture } from './fixtures/dashboard';
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
