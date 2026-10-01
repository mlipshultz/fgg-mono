import type { Activity } from '@fgg/types';
import ui from '@/components/ui.module.css';
import styles from './Sections.module.css';

const GLYPHS = ['★', '◆', '●', '▲', '⇄', '⚑'];
const BG = [styles.bgYellow, styles.bgPink, styles.bgAqua];

export function Activities({ activities }: { activities: Activity[] }) {
  const sorted = [...activities].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <section id="activities" className={styles.activities} aria-labelledby="activities-title">
      <div className={styles.activitiesHead}>
        <div>
          <span className={`${ui.eyebrow} ${ui.eyebrowInk}`}>Classic FGG activities</span>
          <h2 id="activities-title" className={ui.h2}>
            Something for every kind of fan
          </h2>
        </div>
        <span className={styles.activitiesLead}>
          Every activity earns XP. Free with admission, always family-friendly.
        </span>
      </div>
      <div className={styles.activitiesGrid}>
        {sorted.map((a, i) => (
          <div key={a.id} className={styles.activity}>
            <span className={`${styles.activityIcon} ${BG[i % 3]}`} aria-hidden="true">
              {a.iconKey ? <img src={a.iconKey} alt="" /> : GLYPHS[i % GLYPHS.length]}
            </span>
            <span>
              <span className={styles.activityName}>{a.name}</span>
              <span className={styles.activityDesc}>{a.description}</span>
              <span className={styles.xp}>+{a.xp} XP</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
