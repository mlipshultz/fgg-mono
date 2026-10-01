import type { Metadata } from 'next';
import { Placeholder } from '@/components/Placeholder';

export const metadata: Metadata = { title: 'Log in' };

export default function LoginPage() {
  return (
    <Placeholder eyebrow="Accounts" title="Log in is on the way">
      <p>
        Attendee and vendor accounts arrive with the next release. Join the email list on the
        homepage and you&apos;ll hear the moment they open.
      </p>
    </Placeholder>
  );
}
