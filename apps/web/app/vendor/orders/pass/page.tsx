import type { Metadata } from 'next';
import { VendorGate } from '@/components/vendor/VendorGate';
import { Pass } from './Pass';

export const metadata: Metadata = { title: 'Vendor pass' };

export default function VendorPassPage() {
  return (
    <VendorGate>
      <Pass />
    </VendorGate>
  );
}
