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

/** A same-origin path from ?next=, else the fallback. Blocks open redirects. */
export function safeNext(q: URLSearchParams | null, fallback: string): string {
  const next = q?.get('next') ?? '';
  return next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}
