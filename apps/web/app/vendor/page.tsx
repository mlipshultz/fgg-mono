import type { Metadata } from 'next';
import { VendorGate } from '@/components/vendor/VendorGate';
import { VendorDashboardView } from './VendorDashboardView';

export const metadata: Metadata = { title: 'Vendor dashboard' };

export default function VendorPage() {
  return (
    <VendorGate>
      <VendorDashboardView />
    </VendorGate>
  );
}
