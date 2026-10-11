import type { Metadata } from 'next';
import { AuthGate } from '@/components/auth/AuthGate';
import { SettingsAdmin } from './SettingsAdmin';

export const metadata: Metadata = { title: 'Settings · Admin' };

export default function AdminSettingsPage() {
  return (
    <AuthGate roles={['superadmin']}>
      <SettingsAdmin />
    </AuthGate>
  );
}
