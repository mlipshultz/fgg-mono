import type { ReactNode } from 'react';
import { Button } from './Button';
import ui from './ui.module.css';
import styles from './Placeholder.module.css';

export function Placeholder({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <span className={ui.eyebrow}>{eyebrow}</span>
        <h1 className={styles.title}>{title}</h1>
        <div className={styles.text}>{children}</div>
        <Button href="/" variant="yellow" size="sm">
          Back to the fest
        </Button>
      </div>
    </main>
  );
}
