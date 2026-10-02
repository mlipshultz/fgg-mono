import type { Metadata } from 'next';
import { AuthGate } from '@/components/auth/AuthGate';
import { OrdersAdmin } from './OrdersAdmin';

export const metadata: Metadata = { title: 'Orders · Admin' };

export default function AdminOrdersPage() {
  return (
    <AuthGate roles={['staff', 'superadmin']}>
      <OrdersAdmin />
    </AuthGate>
  );
}
