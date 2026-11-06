import type { Metadata } from 'next';
import { AgeForm } from './AgeForm';

export const metadata: Metadata = { title: 'One more step', robots: { index: false } };

export default function AgePage() {
  return <AgeForm />;
}
