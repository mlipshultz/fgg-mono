import type { Metadata } from 'next';
import { AuthGate } from '@/components/auth/AuthGate';
import { DashboardView } from './DashboardView';

export const metadata: Metadata = { title: 'My dashboard' };

export default function DashboardPage() {
  return (
    <AuthGate>
      <DashboardView />
    </AuthGate>
  );
}
