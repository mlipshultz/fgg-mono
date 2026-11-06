'use client';

import { type ChangeEvent, type FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminActivity, AdminPartner } from '@fgg/types';
import { Button } from '@/components/Button';
import styles from '@/components/admin/admin.module.css';
import ui from '@/components/ui.module.css';
import {
  adminCreateActivity,
  adminCreatePartner,
  adminDeleteActivity,
  adminDeletePartner,
  adminListActivities,
  adminListPartners,
  adminMoveActivity,
  adminMovePartner,
  adminUpdateActivity,
  adminUpdatePartner,
  adminUploadContentImage,
} from '@/lib/api';
import { resizeImage } from '@/lib/image';
import local from './content.module.css';

const IMAGE_TYPES = 'image/png,image/jpeg,image/webp';
/** The home page shows logos on 200×96 tiles and icons at 56px; upload about twice that. */
const MAX_PX = { partner: 400, activity: 160 } as const;
const GLYPHS = ['★', '◆', '●', '▲', '⇄', '⚑'];

/** Shrink in the browser, then upload. */
async function upload(kind: 'partner' | 'activity', file: File) {
  const { blob, contentType } = await resizeImage(file, MAX_PX[kind]);
  return adminUploadContentImage(kind, blob, contentType);
}

const isUrl = (s: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(s).protocol);
  } catch {
    return false;
  }
};

type PartnerEdit = { name: string; url: string };
type ActivityEdit = { name: string; description: string; xp: string };

/**
 * The two lists on the home page that only staff curate: partner logos (with an optional link)
 * and the "Classic FGG activities" tiles. Public pages change after a site rebuild.
 */
export function ContentAdmin() {
  const [partners, setPartners] = useState<AdminPartner[] | null>(null);
  const [activities, setActivities] = useState<AdminActivity[] | null>(null);
  const [partnerEdits, setPartnerEdits] = useState<Record<string, PartnerEdit>>({});
  const [activityEdits, setActivityEdits] = useState<Record<string, ActivityEdit>>({});
  const [newPartner, setNewPartner] = useState({ name: '', url: '', file: null as File | null });
  const [newActivity, setNewActivity] = useState({
    name: '',
    description: '',
    xp: '25',
    file: null as File | null,
  });
  const [fileKey, setFileKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([adminListPartners(), adminListActivities()])
      .then(([p, a]) => {
        setPartners(p.items);
        setActivities(a.items);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load'));
  }, []);

  const run = async (key: string, fn: () => Promise<void>, done?: string) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      if (done) setToast(`${done} The home page shows it after the next site rebuild.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };
  const replacePartner = (p: AdminPartner) =>
    setPartners((cur) => (cur ?? []).map((x) => (x.id === p.id ? p : x)));
  const replaceActivity = (a: AdminActivity) =>
    setActivities((cur) => (cur ?? []).map((x) => (x.id === a.id ? a : x)));

  // Partners -----------------------------------------------------------------------------------
  const addPartner = (ev: FormEvent) => {
    ev.preventDefault();
    const name = newPartner.name.trim();
    const url = newPartner.url.trim();
    if (!name) return setError('Give the partner a name.');
    if (!newPartner.file) return setError('Choose a logo (PNG, JPG or WebP).');
    if (url && !isUrl(url)) return setError('The link should start with https://');
    const file = newPartner.file;
    void run(
      'add-partner',
      async () => {
        const up = await upload('partner', file);
        const p = await adminCreatePartner(
          { name, logoKey: up.key, ...(url ? { url } : {}) },
          up.url,
        );
        setPartners((cur) => [...(cur ?? []), p]);
        setNewPartner({ name: '', url: '', file: null });
        setFileKey((k) => k + 1);
      },
      `Added ${name}.`,
    );
  };

  const savePartner = (p: AdminPartner) => {
    const e = partnerEdits[p.id];
    if (!e) return;
    const name = e.name.trim();
    const url = e.url.trim();
    if (!name) return setError('A partner needs a name.');
    if (url && !isUrl(url)) return setError('The link should start with https://');
    void run(
      p.id,
      async () => {
        replacePartner(await adminUpdatePartner(p, { name, url }));
        setPartnerEdits(({ [p.id]: _, ...rest }) => rest);
      },
      'Saved.',
    );
  };

  const replaceLogo = (p: AdminPartner) => (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    void run(
      p.id,
      async () => {
        const up = await upload('partner', file);
        replacePartner(await adminUpdatePartner(p, { logoKey: up.key }, up.url));
      },
      `New logo for ${p.name}.`,
    );
  };

  // Activities ---------------------------------------------------------------------------------
  const addActivity = (ev: FormEvent) => {
    ev.preventDefault();
    const name = newActivity.name.trim();
    const xp = Number(newActivity.xp);
    if (!name) return setError('Give the activity a name.');
    if (!Number.isInteger(xp) || xp < 0) return setError('XP should be a whole number.');
    const file = newActivity.file;
    void run(
      'add-activity',
      async () => {
        const up = file ? await upload('activity', file) : undefined;
        const a = await adminCreateActivity(
          {
            name,
            description: newActivity.description.trim(),
            xp,
            ...(up ? { iconKey: up.key } : {}),
          },
          up?.url,
        );
        setActivities((cur) => [...(cur ?? []), a]);
        setNewActivity({ name: '', description: '', xp: '25', file: null });
        setFileKey((k) => k + 1);
      },
      `Added ${name}.`,
    );
  };

  const saveActivity = (a: AdminActivity) => {
    const e = activityEdits[a.id];
    if (!e) return;
    const xp = Number(e.xp);
    if (!e.name.trim()) return setError('An activity needs a name.');
    if (!Number.isInteger(xp) || xp < 0) return setError('XP should be a whole number.');
    void run(
      a.id,
      async () => {
        replaceActivity(
          await adminUpdateActivity(a, {
            name: e.name.trim(),
            description: e.description.trim(),
            xp,
          }),
        );
        setActivityEdits(({ [a.id]: _, ...rest }) => rest);
      },
      'Saved.',
    );
  };

  const setIcon = (a: AdminActivity) => (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    void run(
      a.id,
      async () => {
        const up = await upload('activity', file);
        replaceActivity(await adminUpdateActivity(a, { iconKey: up.key }, up.url));
      },
      `New icon for ${a.name}.`,
    );
  };

  const moveButtons = (
    label: string,
    i: number,
    count: number,
    key: string,
    move: (dir: 'up' | 'down') => Promise<void>,
  ) => (
    <>
      <button
        type="button"
        className={local.link}
        aria-label={`Move ${label} earlier`}
        disabled={busy !== null || i === 0}
        onClick={() => void run(key, () => move('up'))}
      >
        ↑ Earlier
      </button>
      <button
        type="button"
        className={local.link}
        aria-label={`Move ${label} later`}
        disabled={busy !== null || i === count - 1}
        onClick={() => void run(key, () => move('down'))}
      >
        ↓ Later
      </button>
    </>
  );

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <div>
          <span className={ui.eyebrow}>Admin</span>
          <h1 className={styles.title}>Partners &amp; activities</h1>
        </div>
      </div>
      <p className={local.note}>
        Both lists appear on the home page, in this order. Changes go live after the next site
        rebuild (<Link href="/admin/events">Rebuild site</Link> on the Events page).
      </p>

      {toast && (
        <div className={styles.toast} role="status">
          {toast}
        </div>
      )}
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {/* Partners */}
      <section className={styles.card} aria-labelledby="partners-title">
        <h2 id="partners-title" className={styles.cardTitle}>
          Partners
        </h2>
        <form className={local.add} onSubmit={addPartner} noValidate>
          <label className={local.field}>
            Name
            <input
              value={newPartner.name}
              placeholder="Card Corner MD"
              onChange={(e) => setNewPartner({ ...newPartner, name: e.target.value })}
            />
          </label>
          <label className={local.field}>
            Link (optional)
            <input
              value={newPartner.url}
              placeholder="https://"
              inputMode="url"
              onChange={(e) => setNewPartner({ ...newPartner, url: e.target.value })}
            />
          </label>
          <label className={local.field}>
            Logo (PNG, JPG or WebP)
            <input
              key={`partner-file-${fileKey}`}
              type="file"
              accept={IMAGE_TYPES}
              onChange={(e) => setNewPartner({ ...newPartner, file: e.target.files?.[0] ?? null })}
            />
          </label>
          <div>
            <Button type="submit" variant="dark" size="sm" disabled={busy !== null}>
              {busy === 'add-partner' ? 'Adding…' : 'Add partner'}
            </Button>
          </div>
        </form>
        {partners === null && !error && <p className={styles.muted}>Loading partners…</p>}
        {partners?.length === 0 && <p className={styles.muted}>No partners yet.</p>}
        {partners && partners.length > 0 && (
          <ol className={local.grid} aria-label="Partners">
            {partners.map((p, i) => {
              const e = partnerEdits[p.id] ?? { name: p.name, url: p.url ?? '' };
              const edit = (patch: Partial<PartnerEdit>) =>
                setPartnerEdits({ ...partnerEdits, [p.id]: { ...e, ...patch } });
              return (
                <li key={p.id} className={local.item} aria-label={p.name}>
                  <span className={local.kind}>Partner · {i + 1}</span>
                  <img src={p.logoUrl} alt={`${p.name} logo`} className={local.logo} />
                  <label className={local.field}>
                    Name
                    <input value={e.name} onChange={(ev) => edit({ name: ev.target.value })} />
                  </label>
                  <label className={local.field}>
                    Link
                    <input
                      value={e.url}
                      placeholder="No link"
                      inputMode="url"
                      onChange={(ev) => edit({ url: ev.target.value })}
                    />
                  </label>
                  <div className={local.row}>
                    {partnerEdits[p.id] && (
                      <Button
                        type="button"
                        variant="dark"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => savePartner(p)}
                      >
                        Save
                      </Button>
                    )}
                    <label className={local.fileLabel}>
                      Replace logo
                      <input
                        type="file"
                        accept={IMAGE_TYPES}
                        aria-label={`Replace ${p.name} logo`}
                        disabled={busy !== null}
                        onChange={replaceLogo(p)}
                      />
                    </label>
                    {moveButtons(p.name, i, partners.length, p.id, async (dir) =>
                      setPartners((await adminMovePartner(p, dir)).items),
                    )}
                  </div>
                  <div className={local.row}>
                    <button
                      type="button"
                      className={local.link}
                      aria-label={`Delete ${p.name}`}
                      disabled={busy !== null}
                      onClick={() => {
                        if (!window.confirm(`Remove ${p.name} from the home page?`)) return;
                        void run(
                          p.id,
                          async () => {
                            await adminDeletePartner(p);
                            setPartners((cur) => (cur ?? []).filter((x) => x.id !== p.id));
                          },
                          `Removed ${p.name}.`,
                        );
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Activities */}
      <section className={styles.card} aria-labelledby="activities-title">
        <h2 id="activities-title" className={styles.cardTitle}>
          Activities
        </h2>
        <form className={local.add} onSubmit={addActivity} noValidate>
          <label className={local.field}>
            Name
            <input
              value={newActivity.name}
              maxLength={60}
              placeholder="Art Station"
              onChange={(e) => setNewActivity({ ...newActivity, name: e.target.value })}
            />
          </label>
          <label className={local.field}>
            One-line description
            <input
              value={newActivity.description}
              maxLength={160}
              placeholder="Draw your own creature card at the free art tables."
              onChange={(e) => setNewActivity({ ...newActivity, description: e.target.value })}
            />
          </label>
          <label className={local.field}>
            XP
            <input
              value={newActivity.xp}
              inputMode="numeric"
              onChange={(e) =>
                setNewActivity({ ...newActivity, xp: e.target.value.replace(/\D/g, '') })
              }
            />
          </label>
          <label className={local.field}>
            Icon (optional)
            <input
              key={`activity-file-${fileKey}`}
              type="file"
              accept={IMAGE_TYPES}
              onChange={(e) =>
                setNewActivity({ ...newActivity, file: e.target.files?.[0] ?? null })
              }
            />
          </label>
          <div>
            <Button type="submit" variant="dark" size="sm" disabled={busy !== null}>
              {busy === 'add-activity' ? 'Adding…' : 'Add activity'}
            </Button>
          </div>
        </form>
        {activities === null && !error && <p className={styles.muted}>Loading activities…</p>}
        {activities?.length === 0 && <p className={styles.muted}>No activities yet.</p>}
        {activities && activities.length > 0 && (
          <ol className={local.grid} aria-label="Activities">
            {activities.map((a, i) => {
              const e = activityEdits[a.id] ?? {
                name: a.name,
                description: a.description,
                xp: String(a.xp),
              };
              const edit = (patch: Partial<ActivityEdit>) =>
                setActivityEdits({ ...activityEdits, [a.id]: { ...e, ...patch } });
              return (
                <li key={a.id} className={local.item} aria-label={a.name}>
                  <span className={local.kind}>Activity · {i + 1}</span>
                  <div className={local.iconRow}>
                    <span className={local.icon} aria-hidden="true">
                      {a.iconUrl ? <img src={a.iconUrl} alt="" /> : GLYPHS[i % GLYPHS.length]}
                    </span>
                    <label className={local.field} style={{ flex: 1 }}>
                      Name
                      <input
                        value={e.name}
                        maxLength={60}
                        onChange={(ev) => edit({ name: ev.target.value })}
                      />
                    </label>
                  </div>
                  <label className={local.field}>
                    Description
                    <textarea
                      rows={3}
                      value={e.description}
                      maxLength={160}
                      onChange={(ev) => edit({ description: ev.target.value })}
                    />
                  </label>
                  <label className={local.field}>
                    XP
                    <input
                      value={e.xp}
                      inputMode="numeric"
                      onChange={(ev) => edit({ xp: ev.target.value.replace(/\D/g, '') })}
                    />
                  </label>
                  <div className={local.row}>
                    {activityEdits[a.id] && (
                      <Button
                        type="button"
                        variant="dark"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => saveActivity(a)}
                      >
                        Save
                      </Button>
                    )}
                    <label className={local.fileLabel}>
                      {a.iconUrl ? 'Replace icon' : 'Add icon'}
                      <input
                        type="file"
                        accept={IMAGE_TYPES}
                        aria-label={`${a.iconUrl ? 'Replace' : 'Add'} ${a.name} icon`}
                        disabled={busy !== null}
                        onChange={setIcon(a)}
                      />
                    </label>
                    {a.iconUrl && (
                      <button
                        type="button"
                        className={local.link}
                        disabled={busy !== null}
                        onClick={() =>
                          void run(
                            a.id,
                            async () =>
                              replaceActivity(await adminUpdateActivity(a, { iconKey: '' })),
                            `Removed the icon from ${a.name}.`,
                          )
                        }
                      >
                        Remove icon
                      </button>
                    )}
                  </div>
                  <div className={local.row}>
                    {moveButtons(a.name, i, activities.length, a.id, async (dir) =>
                      setActivities((await adminMoveActivity(a, dir)).items),
                    )}
                    <button
                      type="button"
                      className={local.link}
                      aria-label={`Delete ${a.name}`}
                      disabled={busy !== null}
                      onClick={() => {
                        if (!window.confirm(`Remove ${a.name} from the home page?`)) return;
                        void run(
                          a.id,
                          async () => {
                            await adminDeleteActivity(a);
                            setActivities((cur) => (cur ?? []).filter((x) => x.id !== a.id));
                          },
                          `Removed ${a.name}.`,
                        );
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}
