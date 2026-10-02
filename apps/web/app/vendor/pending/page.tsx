import type { Metadata } from 'next';
import { AuthGate } from '@/components/auth/AuthGate';
import { Pending } from './Pending';

export const metadata: Metadata = { title: 'Vendor application' };

export default function VendorPendingPage() {
  return (
    <AuthGate>
      <Pending />
    </AuthGate>
  );
}
