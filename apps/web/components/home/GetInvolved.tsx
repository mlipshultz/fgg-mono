import type { PublicSettings } from '@fgg/types';
import { Button } from '@/components/Button';
import ui from '@/components/ui.module.css';
import styles from './Sections.module.css';

export function GetInvolved({ settings }: { settings: PublicSettings }) {
  const discord = settings.discordInviteUrl ?? settings.social.discord ?? '#';
  return (
    <section id="get-involved" className={styles.involved} aria-labelledby="involved-title">
      <div className={styles.involvedHead}>
        <span className={ui.eyebrow}>Get involved</span>
        <h2 id="involved-title" className={ui.h2}>
          Help us throw the next one
        </h2>
      </div>
      <div className={`${styles.involvedCard} ${styles.bgYellow}`}>
        <span className={styles.involvedIcon} aria-hidden="true">
          ★
        </span>
        <span className={styles.involvedTitle}>Volunteer</span>
        <p className={styles.involvedText}>
          Run an activity table, help at check-in, or judge the costume contest. Volunteers earn
          double XP and a crew shirt.
        </p>
        <Button href={discord} variant="dark" size="md" className={styles.accountCta}>
          Join the FGG Discord
        </Button>
      </div>
      <div className={`${styles.involvedCard} ${styles.bgPink}`}>
        <span className={styles.involvedIcon} aria-hidden="true">
          ◆
        </span>
        <span className={styles.involvedTitle}>Partner with us</span>
        <p className={styles.involvedText}>
          Sponsor a show, host an activity, or bring FGG to your venue. Tell us what you have in
          mind.
        </p>
        <Button href="/contact" variant="dark" size="md" className={styles.accountCta}>
          Contact us
        </Button>
      </div>
    </section>
  );
}
