import type { Metadata } from 'next';
import { AuthGate } from '@/components/auth/AuthGate';
import { ContentAdmin } from './ContentAdmin';

export const metadata: Metadata = { title: 'Partners & activities · Admin' };

export default function AdminContentPage() {
  return (
    <AuthGate roles={['staff', 'superadmin']}>
      <ContentAdmin />
    </AuthGate>
  );
}
