import { theme } from '@fgg/tokens/theme';
import styles from './page.module.css';

// Phase 0 sample page: proves the token pipeline renders on web. Kept as the living styleguide.
function Cell({ id, label, cls = '' }: { id: string; label?: string; cls?: string }) {
  return (
    <div className={styles.cellWrap}>
      <span className={`${styles.cell} ${cls}`} aria-label={label ? `${id}, ${label}` : id}>
        <span className={styles.cellId}>{id}</span>
      </span>
      {label && <span className={styles.cellLabel}>{label}</span>}
    </div>
  );
}

export default function TokensPage() {
  const colors = Object.entries(theme.color);
  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>Design tokens · styleguide</p>
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

      <h2 className={styles.h2}>Table availability by day</h2>
      <p className={styles.tagline}>
        Proposal for the multi-table picker: plain white means open every day, taken is grey, and a
        table open on only some days carries that day&apos;s colour and line direction. The day
        filter chips use the same marks, so they double as the legend.
      </p>

      <p className={styles.sub}>Two-day event · stripes</p>
      <div className={styles.cells}>
        <Cell id="B7" label="Open all days" />
        <Cell id="B8" label="Sat only" cls={styles.sat} />
        <Cell id="B9" label="Sun only" cls={styles.sun} />
        <Cell id="B10" label="Taken" cls={styles.taken} />
        <Cell id="C4" label="Your pick" cls={styles.picked} />
      </div>

      <p className={styles.sub}>Same states as solid tints, for comparison</p>
      <div className={styles.cells}>
        <Cell id="B7" label="Open all days" />
        <Cell id="B8" label="Sat only" cls={styles.satTint} />
        <Cell id="B9" label="Sun only" cls={styles.sunTint} />
        <Cell id="B10" label="Taken" cls={styles.taken} />
        <Cell id="C4" label="Your pick" cls={styles.picked} />
      </div>

      <p className={styles.sub}>Day filter chips (also the legend)</p>
      <div className={styles.row}>
        <span className={`${styles.chip} ${styles.chipOn}`}>All days</span>
        <span className={`${styles.chip} ${styles.chipSat}`}>Sat Oct 24</span>
        <span className={`${styles.chip} ${styles.chipSun}`}>Sun Oct 25</span>
      </div>

      <p className={styles.sub}>In context · one row of the map</p>
      <div className={styles.mapRow}>
        <span className={styles.rowLabel}>B</span>
        {[
          ['B1', styles.taken],
          ['B2', ''],
          ['B3', styles.sat],
          ['B4', ''],
          ['B5', styles.picked],
          ['B6', styles.sun],
          ['B7', ''],
          ['B8', styles.taken],
          ['B9', ''],
          ['B10', styles.sat],
        ].map(([id, cls]) => (
          <Cell key={id} id={id!} cls={cls} />
        ))}
      </div>

      <p className={styles.sub}>
        Three-day event (Harbor Fest) · Fri pink —, Sat aqua /, Sun yellow \
      </p>
      <div className={styles.cells}>
        <Cell id="A1" label="All 3 days" />
        <Cell id="A2" label="Fri only" cls={styles.fri} />
        <Cell id="A3" label="Sat + Sun" cls={`${styles.sat} ${styles.sunAlso}`} />
        <Cell id="A4" label="Fri + Sat" cls={`${styles.fri} ${styles.satAlso}`} />
        <Cell id="A5" label="Taken" cls={styles.taken} />
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
