import type { Metadata } from 'next';
import { VendorGate } from '@/components/vendor/VendorGate';
import { Done } from './Done';

export const metadata: Metadata = { title: "You're booked" };

export default function VendorOrderDonePage() {
  return (
    <VendorGate>
      <Done />
    </VendorGate>
  );
}
