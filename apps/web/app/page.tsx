import { theme } from '@fgg/tokens/theme';
import styles from './page.module.css';

// Phase 0 sample page: proves the token pipeline renders on web.
// Replaced by the real homepage in Phase 1.
export default function TokensPage() {
  const colors = Object.entries(theme.color);
  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>Design tokens · sample</p>
      <h1 className={styles.hero}>The feel-good card &amp; gaming fest</h1>
      <p className={styles.tagline}>
        Every value on this page comes from <code>packages/tokens</code>. Web reads CSS variables;
        mobile reads the same values as a theme object.
      </p>

      <div className={styles.row}>
        <button className={`${styles.button} ${styles.primary}`}>See Upcoming Events</button>
        <button className={styles.button}>Become a Vendor</button>
        <button className={`${styles.button} ${styles.yellow}`}>Upcoming Events</button>
        <button className={`${styles.button} ${styles.dark}`}>Book &amp; Pay Now</button>
      </div>

      <h2 className={styles.h2}>Colors</h2>
      <div className={styles.swatches}>
        {colors.map(([name, hex]) => (
          <div key={name} className={styles.swatch}>
            <div className={styles.swatchColor} style={{ background: hex }} />
            <div className={styles.swatchLabel}>
              {name}
              <small>{hex}</small>
            </div>
          </div>
        ))}
      </div>

      <h2 className={styles.h2}>Cards &amp; status</h2>
      <div className={styles.cards}>
        <div className={`${styles.card} ${styles.cardYellow}`}>
          <h3 className={styles.cardTitle}>Halloween Fest</h3>
          <span className={`${styles.pill} ${styles.open}`}>Open · 12 left</span>
        </div>
        <div className={`${styles.card} ${styles.cardAqua}`}>
          <h3 className={styles.cardTitle}>Spring Fest</h3>
          <span className={`${styles.pill} ${styles.soon}`}>Coming soon</span>
        </div>
        <div className={`${styles.card} ${styles.cardPink}`}>
          <h3 className={styles.cardTitle}>Harbor Fest</h3>
          <span className={`${styles.pill} ${styles.closed}`}>Closed</span>
        </div>
      </div>
    </main>
  );
}
