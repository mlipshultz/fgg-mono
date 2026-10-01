import {
  type ContactSubmissionInput,
  EventAvailability,
  GalleryPage,
  HomeContent,
  type SubscribeInput,
  type WaitlistInput,
} from '@fgg/types';
import { homeFixture } from './fixtures/home';
import { galleryFixture } from './fixtures/gallery';

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? '';

/** Fixture media uses an absolute placeholder origin (the schema requires URLs); serve it from /public. */
const FIXTURE_ORIGIN = 'https://fixture.local';
function localize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).split(FIXTURE_ORIGIN).join('')) as T;
}

export const hasApi = API_URL.length > 0;

const fake = <T>(value: T, ms = 400) => new Promise<T>((r) => setTimeout(() => r(value), ms));

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
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
