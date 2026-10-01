'use client';

import { useEffect, useState } from 'react';
import { Placeholder } from '@/components/Placeholder';

export function BookPlaceholder() {
  const [event, setEvent] = useState<string | null>(null);
  useEffect(() => {
    setEvent(new URLSearchParams(window.location.search).get('event'));
  }, []);
  const name = event ? event.replace(/-\d{4}$/, '').replace(/-/g, ' ') : null;
  return (
    <Placeholder eyebrow="Vendors" title="Table booking opens soon">
      <p>
        {name ? (
          <>
            Thanks for your interest in vending at{' '}
            <b style={{ textTransform: 'capitalize' }}>{name}</b>.{' '}
          </>
        ) : null}
        Pick-your-table booking with online payment is the next thing we&apos;re building. Until
        then, email <a href="mailto:hello@feelgoodgaming.com">hello@feelgoodgaming.com</a> to
        reserve a spot.
      </p>
    </Placeholder>
  );
}
