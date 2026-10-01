import Link from 'next/link';
import type { PublicPartner } from '@fgg/types';
import ui from '@/components/ui.module.css';
import styles from './Sections.module.css';

export function Partners({ partners }: { partners: PublicPartner[] }) {
  const sorted = [...partners].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <section id="partners" className={styles.partners} aria-labelledby="partners-title">
      <div>
        <span className={ui.eyebrow}>Partners</span>
        <h2 id="partners-title" className={ui.h2}>
          The folks who make it happen
        </h2>
      </div>
      <div className={styles.partnerRow}>
        {sorted.map((p) =>
          p.url ? (
            <a
              key={p.id}
              href={p.url}
              className={styles.partnerTile}
              target="_blank"
              rel="noreferrer"
            >
              <img src={p.logoUrl} alt={p.name} />
            </a>
          ) : (
            <div key={p.id} className={styles.partnerTile}>
              <img src={p.logoUrl} alt={p.name} />
            </div>
          ),
        )}
        <Link href="/contact" className={styles.partnerMore}>
          Become a Partner →
        </Link>
      </div>
    </section>
  );
}
