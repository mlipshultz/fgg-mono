import type { Metadata } from 'next';
import { ForgotForm } from './ForgotForm';

export const metadata: Metadata = { title: 'Reset your password' };

export default function ForgotPage() {
  return <ForgotForm />;
}
