import type { Metadata } from 'next';
import { AuthGate } from '@/components/auth/AuthGate';
import { GalleryAdmin } from './GalleryAdmin';

export const metadata: Metadata = { title: 'Gallery · Admin' };

export default function AdminGalleryPage() {
  return (
    <AuthGate roles={['staff', 'superadmin']}>
      <GalleryAdmin />
    </AuthGate>
  );
}
