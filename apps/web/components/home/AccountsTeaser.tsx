import { Button } from '@/components/Button';
import ui from '@/components/ui.module.css';
import styles from './Sections.module.css';

export function AccountsTeaser() {
  return (
    <section className={styles.accounts} aria-labelledby="accounts-title">
      <div className={styles.accountsHead}>
        <span className={ui.eyebrow}>Accounts</span>
        <h2 id="accounts-title" className={ui.h2}>
          Level up at every show
        </h2>
        <p className={styles.accountsLead}>
          Two free accounts. One for the fans collecting XP, one for the vendors selling to them.
        </p>
      </div>

      <div className={`${styles.accountCard} ${styles.shadowPink}`}>
        <span className={`${styles.tag} ${styles.bgPink}`}>ATTENDEE</span>
        <span className={styles.accountTitle}>Earn XP, unlock badges, redeem perks</span>
        <div className={styles.xpBar} aria-hidden="true">
          <div className={styles.xpFill} />
        </div>
        <ul className={styles.accountList}>
          <li>+150 XP every time you check in</li>
          <li>Challenges &amp; raffles level you up faster</li>
          <li>Trade XP for raffle entries, sticker packs and early entry</li>
          <li>Save the events you&apos;re going to</li>
        </ul>
        <span className={styles.phoneOnly}>Earn XP, unlock badges, redeem perks.</span>
        <Button href="/signup" variant="dark" size="md" className={styles.accountCta}>
          Create a free account
        </Button>
      </div>

      <div className={`${styles.accountCard} ${styles.shadowAqua}`}>
        <span className={`${styles.tag} ${styles.bgAqua}`}>VENDOR</span>
        <span className={styles.accountTitle}>Book tables in two minutes</span>
        <div className={styles.steps} aria-hidden="true">
          <span className={`${styles.step} ${styles.stepDone}`} />
          <span className={`${styles.step} ${styles.stepDone}`} />
          <span className={styles.step} />
          <span className={styles.step} />
        </div>
        <ul className={styles.accountList}>
          <li>Pick your table on the floor map and pay online</li>
          <li>Receipts, booking history and payment status in one place</li>
          <li>Join the PokéBucks program for half-price tables</li>
          <li>First dibs when new shows open</li>
        </ul>
        <span className={styles.phoneOnly}>Book tables, track payments, get receipts.</span>
        <Button href="/signup?vendor=1" variant="dark" size="md" className={styles.accountCta}>
          Create a vendor account
        </Button>
      </div>

      <div className={styles.syncPill}>
        <span className={styles.phone} aria-hidden="true" />
        Coming soon: your account syncs with the FGG mobile app.
      </div>
    </section>
  );
}
