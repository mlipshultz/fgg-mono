import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';

export const metadata: Metadata = { title: 'Privacy policy' };

export default function PrivacyPage() {
  return (
    <LegalPage eyebrow="Legal" title="Privacy policy" updated="October 2026">
      <p>
        Accounts are for fans 13 and older. We don&apos;t knowingly collect information from
        children under 13; kids take part on a parent&apos;s account.
      </p>
    </LegalPage>
  );
}
