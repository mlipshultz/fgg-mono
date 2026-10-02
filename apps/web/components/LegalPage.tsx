import type { ReactNode } from 'react';
import ui from './ui.module.css';
import styles from './LegalPage.module.css';

/** Placeholder legal page. Real copy is a Phase 6 input (docs/PLAN.md §2). */
export function LegalPage({
  eyebrow,
  title,
  updated,
  children,
}: {
  eyebrow: string;
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className={styles.page}>
      <span className={ui.eyebrow}>{eyebrow}</span>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.updated}>Last updated {updated}</p>
      <div className={styles.todo} role="note">
        <b>TODO · placeholder text.</b> The final {title.toLowerCase()} will be supplied before
        launch and dropped in here.
      </div>
      <div className={styles.body}>{children}</div>
    </main>
  );
}
