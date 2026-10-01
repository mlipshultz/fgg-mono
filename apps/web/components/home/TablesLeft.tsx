'use client';

import { useEffect, useState } from 'react';
import { fetchAvailability } from '@/lib/api';

/** Renders the build-time count, then refreshes it from the API after hydration. */
export function TablesLeft({ eventId, initial }: { eventId: string; initial?: number }) {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    let alive = true;
    fetchAvailability(eventId).then((a) => {
      if (alive && a) setLeft(a.tablesLeft);
    });
    return () => {
      alive = false;
    };
  }, [eventId]);
  return <>{left === undefined ? 'Open' : `Open · ${left} left`}</>;
}
