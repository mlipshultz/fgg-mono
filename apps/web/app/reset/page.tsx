import type { Metadata } from 'next';
import { ResetForm } from './ResetForm';

export const metadata: Metadata = { title: 'Set a new password' };

export default function ResetPage() {
  return <ResetForm />;
}
