import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';

export const metadata: Metadata = { title: 'Vendor code of conduct' };

export default function CodeOfConductPage() {
  return (
    <LegalPage eyebrow="Vendors" title="Vendor code of conduct" updated="October 2026">
      <p>
        Family-friendly displays, fair pricing for kids, no counterfeit product. Load in on time,
        keep your table staffed during show hours, and be kind to the crew and the fans.
      </p>
    </LegalPage>
  );
}
