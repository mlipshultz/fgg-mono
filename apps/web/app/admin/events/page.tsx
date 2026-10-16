import type { Metadata } from 'next';
import { AuthGate } from '@/components/auth/AuthGate';
import { EventsAdmin } from './EventsAdmin';

export const metadata: Metadata = { title: 'Events · Admin' };

export default function AdminEventsPage() {
  return (
    <AuthGate roles={['staff', 'superadmin']}>
      <EventsAdmin />
    </AuthGate>
  );
}
