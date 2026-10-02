import type { ReactNode } from 'react';
import ui from '@/components/ui.module.css';
import styles from './auth.module.css';

/** Centered sticker card used by every account screen (no handoff mock; same language as 1n). */
export function AuthCard({
  eyebrow,
  title,
  lead,
  tone = 'yellow',
  wide = false,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  tone?: 'yellow' | 'pink' | 'aqua';
  wide?: boolean;
  children: ReactNode;
}) {
  const toneClass = tone === 'pink' ? styles.cardPink : tone === 'aqua' ? styles.cardAqua : '';
  return (
    <main className={styles.page}>
      <div className={`${styles.card} ${toneClass} ${wide ? styles.wide : ''}`}>
        <div>
          <span className={ui.eyebrow}>{eyebrow}</span>
          <h1 className={styles.title}>{title}</h1>
          {lead && <p className={styles.lead}>{lead}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}

export function Field({
  label,
  error,
  hint,
  action,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className={styles.field}>
      {action ? (
        <span className={styles.labelRow}>
          <span>{label}</span>
          {action}
        </span>
      ) : (
        label
      )}
      {children}
      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : (
        hint && <span className={styles.hint}>{hint}</span>
      )}
    </label>
  );
}

export function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

export { styles as authStyles };
