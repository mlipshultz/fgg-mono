import type { Metadata } from 'next';
import { AuthGate } from '@/components/auth/AuthGate';
import { ApplicationsAdmin } from './ApplicationsAdmin';

export const metadata: Metadata = { title: 'Vendor applications · Admin' };

export default function AdminApplicationsPage() {
  return (
    <AuthGate roles={['staff', 'superadmin']}>
      <ApplicationsAdmin />
    </AuthGate>
  );
}
