import styles from './vendor.module.css';

const STEPS = ['TABLE', 'PAY', 'DONE'];

/** 3-step progress pills: done = aqua ✓, current = ink, upcoming = white. */
export function StepPills({ current, className }: { current: 1 | 2 | 3; className?: string }) {
  return (
    <ol className={`${styles.steps} ${className ?? ''}`} aria-label="Booking progress">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const cls = n < current ? styles.stepDone : n === current ? styles.stepActive : '';
        return (
          <li
            key={label}
            className={`${styles.step} ${cls}`}
            aria-current={n === current ? 'step' : undefined}
          >
            {n < current ? '✓' : `${n} ${label}`}
          </li>
        );
      })}
    </ol>
  );
}
