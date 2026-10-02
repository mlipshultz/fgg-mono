import type { Metadata } from 'next';
import { AuthGate } from '@/components/auth/AuthGate';
import { ApplyForm } from './ApplyForm';

export const metadata: Metadata = { title: 'Become a vendor' };

export default function VendorApplyPage() {
  return (
    <AuthGate>
      <ApplyForm />
    </AuthGate>
  );
}
