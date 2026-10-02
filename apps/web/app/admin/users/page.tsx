import type { Metadata } from 'next';
import { AuthGate } from '@/components/auth/AuthGate';
import { UsersAdmin } from './UsersAdmin';

export const metadata: Metadata = { title: 'Users · Admin' };

export default function AdminUsersPage() {
  return (
    <AuthGate roles={['staff', 'superadmin']}>
      <UsersAdmin />
    </AuthGate>
  );
}
