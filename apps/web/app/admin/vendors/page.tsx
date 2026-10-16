import type { Metadata } from 'next';
import { AuthGate } from '@/components/auth/AuthGate';
import { VendorsAdmin } from './VendorsAdmin';

export const metadata: Metadata = { title: 'Vendors · Admin' };

export default function AdminVendorsPage() {
  return (
    <AuthGate roles={['staff', 'superadmin']}>
      <VendorsAdmin />
    </AuthGate>
  );
}
