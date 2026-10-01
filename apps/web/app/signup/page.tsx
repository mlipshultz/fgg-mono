import type { Metadata } from 'next';
import { Placeholder } from '@/components/Placeholder';

export const metadata: Metadata = { title: 'Sign up' };

export default function SignupPage() {
  return (
    <Placeholder eyebrow="Accounts" title="Free accounts open soon">
      <p>
        Earn XP, unlock badges and save the events you&apos;re going to. Vendors will apply and book
        tables from the same account. Coming with the next release.
      </p>
    </Placeholder>
  );
}
