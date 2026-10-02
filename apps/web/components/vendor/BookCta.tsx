'use client';

import { Button, type ButtonSize } from '@/components/Button';
import { useAuth } from '@/components/Providers';

/**
 * "Book & Pay Now" routing (handoff §0C): vendor → picker, applicant → pending,
 * signed in (anyone else) → application, signed out → log in then come back.
 */
export function bookHref(
  slug: string,
  status: 'loading' | 'signed-out' | 'signed-in',
  roles: readonly string[] | undefined,
): string {
  const book = `/vendor/book?event=${encodeURIComponent(slug)}`;
  if (status !== 'signed-in') return `/login?next=${encodeURIComponent(book)}`;
  if (roles?.includes('vendor')) return book;
  if (roles?.includes('vendor_applicant')) return '/vendor/pending';
  return `/vendor/apply?event=${encodeURIComponent(slug)}`;
}

export function BookCta({
  slug,
  size = 'sm',
  block = false,
  children = 'Book & Pay Now',
}: {
  slug: string;
  size?: ButtonSize;
  block?: boolean;
  children?: React.ReactNode;
}) {
  const { status, user } = useAuth();
  return (
    <Button href={bookHref(slug, status, user?.roles)} variant="dark" size={size} block={block}>
      {children}
    </Button>
  );
}
