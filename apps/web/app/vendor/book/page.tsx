import type { Metadata } from 'next';
import { BookPlaceholder } from './BookPlaceholder';

export const metadata: Metadata = { title: 'Book a table' };

export default function VendorBookPage() {
  return <BookPlaceholder />;
}
