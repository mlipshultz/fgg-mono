import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';

export const metadata: Metadata = { title: 'Sealed product policy' };

export default function SealedPolicyPage() {
  return (
    <LegalPage eyebrow="Vendors" title="Sealed product policy" updated="October 2026">
      <p>
        Sealed product must be authentic and sold at or below MSRP during show hours. Resealed or
        tampered product is not allowed and results in removal from the show.
      </p>
    </LegalPage>
  );
}
