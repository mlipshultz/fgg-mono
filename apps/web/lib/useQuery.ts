'use client';

import { useEffect, useState } from 'react';

/** Read URL query params on the client only (static export has no server search params). */
export function useQuery(): URLSearchParams | null {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => {
    setQ(new URLSearchParams(window.location.search));
  }, []);
  return q;
}

/**
 * `raw` as a path on this site ("/vendor/book/?event=x"), or undefined if it would leave it.
 * Parsed the way the browser will follow it, so `/\evil.com` or `/<tab>/evil.com`, which
 * browsers treat as `//evil.com`, are refused.
 */
export function safePath(raw: string | null | undefined): string | undefined {
  if (!raw || !raw.startsWith('/') || typeof window === 'undefined') return undefined;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return undefined;
    return url.pathname + url.search + url.hash;
  } catch {
    return undefined;
  }
}

/** A same-origin path from ?next=, else the fallback. Blocks open redirects. */
export function safeNext(q: URLSearchParams | null, fallback: string): string {
  return safePath(q?.get('next')) ?? fallback;
}

/** `?next=…` to carry a validated ?next= on to another auth page ('' when there is none). */
export function nextParam(q: URLSearchParams | null, prefix: '?' | '&' = '?'): string {
  const next = safePath(q?.get('next'));
  return next ? `${prefix}next=${encodeURIComponent(next)}` : '';
}
