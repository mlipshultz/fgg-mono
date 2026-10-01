import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';

export const metadata: Metadata = { title: 'Terms of service' };

export default function TermsPage() {
  return (
    <LegalPage eyebrow="Legal" title="Terms of service" updated="October 2026">
      <p>
        These terms cover attendee accounts, vendor bookings and the FGG mobile app. Vendor table
        bookings are refundable in full up to 14 days before the show.
      </p>
    </LegalPage>
  );
}
