'use client';

import { Button, type ButtonVariant } from '@/components/Button';
import { useAuth } from '@/components/Providers';

/**
 * The site-wide vendor call to action. Attendees see "Become a Vendor" (the application);
 * applicants see their status; approved vendors go straight to their dashboard.
 */
export function VendorCta({
  variant = 'secondary',
  size = 'lg',
  className,
}: {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const { status, user } = useAuth();
  const roles = status === 'signed-in' ? (user?.roles ?? []) : [];
  const target = roles.includes('vendor')
    ? { href: '/vendor', label: 'Vendor dashboard' }
    : roles.includes('vendor_applicant')
      ? { href: '/vendor/pending', label: 'Vendor application' }
      : { href: '/vendor/apply', label: 'Become a Vendor' };
  return (
    <Button href={target.href} variant={variant} size={size} className={className}>
      {target.label}
    </Button>
  );
}
