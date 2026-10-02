import type { Metadata } from 'next';
import { VendorGate } from '@/components/vendor/VendorGate';
import { BookFlow } from './BookFlow';

export const metadata: Metadata = { title: 'Book a table' };

export default function VendorBookPage() {
  return (
    <VendorGate>
      <BookFlow />
    </VendorGate>
  );
}
