'use client';

import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from 'react';
import type { AdminEvent, AdminGalleryItem, GalleryImageUploadInput } from '@fgg/types';
import { Button } from '@/components/Button';
import styles from '@/components/admin/admin.module.css';
import ui from '@/components/ui.module.css';
import {
  adminCreateGalleryItem,
  adminDeleteGalleryItem,
  adminListEvents,
  adminListGallery,
  adminMoveGalleryItem,
  adminUpdateGalleryItem,
  adminUploadGalleryPhoto,
} from '@/lib/api';
import local from './gallery.module.css';

const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
type PhotoType = GalleryImageUploadInput['contentType'];

/** The pixel size of an image file, read in the browser (for the public page's layout). */
async function sizeOf(file: File): Promise<{ width: number; height: number } | undefined> {
  try {
    const bmp = await createImageBitmap(file);
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return size;
  } catch {
    return undefined;
  }
}

/** The editable text of an item, as one or two strings. */
const textOf = (it: AdminGalleryItem): [string, string] =>
  it.type === 'stat'
    ? [it.value, it.label]
    : it.type === 'quote'
      ? [it.text, it.attribution ?? '']
      : [it.caption ?? '', ''];

/**
 * Photos, stats and quotes for a show's gallery: the Past Events page, and the home page strip
 * for featured ones. Uploaded photos are resized into a display copy and a thumbnail by a
 * background job; public pages change after a site rebuild.
 */
export function GalleryAdmin() {
  const [events, setEvents] = useState<AdminEvent[] | null>(null);
  const [eventId, setEventId] = useState('');
  const [items, setItems] = useState<AdminGalleryItem[] | null>(null);
  /** Unsaved text per item: [main, secondary]. */
  const [edits, setEdits] = useState<Record<string, [string, string]>>({});
  const [stat, setStat] = useState({ value: '', label: '' });
  const [quote, setQuote] = useState({ text: '', attribution: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    adminListEvents()
      .then((r) => {
        setEvents(r.events);
        // Start on the most recent show that has already happened.
        const today = new Date().toISOString().slice(0, 10);
        const past = r.events.filter((e) => e.endsAt.slice(0, 10) < today);
        setEventId((past[0] ?? r.events[0])?.id ?? '');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load events'));
  }, []);

  useEffect(() => {
    if (!eventId) return;
    let alive = true;
    setItems(null);
    adminListGallery(eventId)
      .then((r) => alive && setItems(r.items))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Could not load'));
    return () => {
      alive = false;
    };
  }, [eventId]);

  const event = useMemo(() => events?.find((e) => e.id === eventId), [events, eventId]);
  const run = async (key: string, fn: () => Promise<void>, done?: string) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      if (done) setToast(`${done} Public pages show it after the next site rebuild.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };
  const replace = (it: AdminGalleryItem) =>
    setItems((cur) => (cur ?? []).map((x) => (x.id === it.id ? it : x)));

  const uploadPhotos = (ev: ChangeEvent<HTMLInputElement>) => {
    const files = [...(ev.target.files ?? [])];
    ev.target.value = '';
    if (!files.length || !eventId) return;
    const bad = files.find((f) => !(PHOTO_TYPES as readonly string[]).includes(f.type));
    if (bad) return setError(`${bad.name}: use PNG, JPG or WebP photos.`);
    void run(
      'upload',
      async () => {
        for (const [n, file] of files.entries()) {
          setToast(`Uploading ${n + 1} of ${files.length}…`);
          const [up, size] = await Promise.all([
            adminUploadGalleryPhoto(file, file.type as PhotoType),
            sizeOf(file),
          ]);
          const item = await adminCreateGalleryItem(
            { type: 'photo', eventId, mediaKey: up.key, featured: false, ...(size ?? {}) },
            up.url,
          );
          setItems((cur) => [...(cur ?? []), item]);
        }
      },
      `Added ${files.length} ${files.length === 1 ? 'photo' : 'photos'}.`,
    );
  };

  const addStat = (ev: FormEvent) => {
    ev.preventDefault();
    if (!stat.value.trim() || !stat.label.trim())
      return setError('A stat needs a number and a label.');
    void run(
      'stat',
      async () => {
        const item = await adminCreateGalleryItem({
          type: 'stat',
          eventId,
          value: stat.value.trim(),
          label: stat.label.trim(),
          featured: false,
        });
        setItems((cur) => [...(cur ?? []), item]);
        setStat({ value: '', label: '' });
      },
      'Added the stat.',
    );
  };

  const addQuote = (ev: FormEvent) => {
    ev.preventDefault();
    if (!quote.text.trim()) return setError('A quote needs some words.');
    void run(
      'quote',
      async () => {
        const item = await adminCreateGalleryItem({
          type: 'quote',
          eventId,
          text: quote.text.trim(),
          ...(quote.attribution.trim() ? { attribution: quote.attribution.trim() } : {}),
          featured: false,
        });
        setItems((cur) => [...(cur ?? []), item]);
        setQuote({ text: '', attribution: '' });
      },
      'Added the quote.',
    );
  };

  const saveText = (it: AdminGalleryItem) => {
    const [a, b] = edits[it.id] ?? textOf(it);
    const update =
      it.type === 'stat'
        ? { value: a.trim(), label: b.trim() }
        : it.type === 'quote'
          ? { text: a.trim(), attribution: b.trim() }
          : { caption: a.trim() };
    void run(
      it.id,
      async () => {
        replace(await adminUpdateGalleryItem(it, update));
        setEdits(({ [it.id]: _, ...rest }) => rest);
      },
      'Saved.',
    );
  };

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <div>
          <span className={ui.eyebrow}>Admin</span>
          <h1 className={styles.title}>Gallery</h1>
        </div>
        <div className={styles.filters}>
          <select
            className={styles.select}
            value={eventId}
            aria-label="Show"
            onChange={(e) => {
              setToast(null);
              setEventId(e.target.value);
            }}
          >
            {(events ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} {e.days[0]?.date.slice(0, 4)}
              </option>
            ))}
          </select>
        </div>
      </div>

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

      {event && (
        <section className={styles.card} aria-labelledby="add">
          <span id="add" className={styles.cardTitle}>
            Add to {event.name}
          </span>
          <div className={local.add}>
            <label className={local.field}>
              Photos (PNG, JPG or WebP; resized automatically)
              <input
                type="file"
                multiple
                accept={PHOTO_TYPES.join(',')}
                aria-label="Upload photos"
                disabled={busy !== null}
                onChange={uploadPhotos}
              />
            </label>
            <form className={local.field} onSubmit={addStat} noValidate>
              <span>Stat</span>
              <div className={local.row}>
                <input
                  aria-label="Stat number"
                  placeholder="120+"
                  value={stat.value}
                  onChange={(e) => setStat({ ...stat, value: e.target.value })}
                />
                <input
                  aria-label="Stat label"
                  placeholder="vendors"
                  value={stat.label}
                  onChange={(e) => setStat({ ...stat, label: e.target.value })}
                />
                <Button type="submit" variant="outline" size="sm" disabled={busy !== null}>
                  Add stat
                </Button>
              </div>
            </form>
            <form className={local.field} onSubmit={addQuote} noValidate>
              <span>Quote</span>
              <input
                aria-label="Quote text"
                placeholder="Best day of my summer!"
                value={quote.text}
                onChange={(e) => setQuote({ ...quote, text: e.target.value })}
              />
              <div className={local.row}>
                <input
                  aria-label="Quote attribution"
                  placeholder="A parent (optional)"
                  value={quote.attribution}
                  onChange={(e) => setQuote({ ...quote, attribution: e.target.value })}
                />
                <Button type="submit" variant="outline" size="sm" disabled={busy !== null}>
                  Add quote
                </Button>
              </div>
            </form>
          </div>
        </section>
      )}

      {items === null && eventId && !error && <p className={styles.muted}>Loading gallery…</p>}
      {items?.length === 0 && (
        <p className={styles.muted}>Nothing in this show&apos;s gallery yet.</p>
      )}
      {items && items.length > 0 && (
        <ol className={local.grid} aria-label="Gallery items">
          {items.map((it, i) => {
            const [a, b] = edits[it.id] ?? textOf(it);
            const changed = edits[it.id] !== undefined;
            const label =
              it.type === 'photo'
                ? `Photo ${i + 1}`
                : it.type === 'stat'
                  ? `Stat ${it.value}`
                  : it.type === 'quote'
                    ? `Quote ${i + 1}`
                    : `Video ${i + 1}`;
            return (
              <li key={it.id} className={local.item} aria-label={label}>
                <span className={local.kind}>
                  {it.type} · {i + 1}
                </span>
                {it.type === 'photo' ? (
                  <img
                    src={it.thumbUrl}
                    alt={it.caption ?? ''}
                    className={local.thumb}
                    // Resized copies appear a few seconds after upload; show the original until then.
                    onError={(e) => {
                      if (it.originalUrl && e.currentTarget.src !== it.originalUrl)
                        e.currentTarget.src = it.originalUrl;
                    }}
                  />
                ) : it.type === 'video' ? (
                  <img src={it.posterUrl} alt="" className={local.thumb} />
                ) : it.type === 'stat' ? (
                  <div className={local.textTile}>
                    <span className={local.statValue}>{it.value}</span>
                    <span>{it.label}</span>
                  </div>
                ) : (
                  <div className={local.textTile}>“{it.text}”</div>
                )}
                {it.type !== 'video' && (
                  <>
                    <label className={local.field}>
                      {it.type === 'stat' ? 'Number' : it.type === 'quote' ? 'Quote' : 'Caption'}
                      <input
                        value={a}
                        onChange={(e) => setEdits({ ...edits, [it.id]: [e.target.value, b] })}
                      />
                    </label>
                    {it.type !== 'photo' && (
                      <label className={local.field}>
                        {it.type === 'stat' ? 'Label' : 'Who said it'}
                        <input
                          value={b}
                          onChange={(e) => setEdits({ ...edits, [it.id]: [a, e.target.value] })}
                        />
                      </label>
                    )}
                  </>
                )}
                <label className={local.check}>
                  <input
                    type="checkbox"
                    checked={it.featured}
                    disabled={busy !== null}
                    onChange={(e) => {
                      // Flip it straight away; put it back if saving fails.
                      const featured = e.target.checked;
                      replace({ ...it, featured });
                      void run(
                        it.id,
                        async () => {
                          try {
                            replace(await adminUpdateGalleryItem(it, { featured }));
                          } catch (err) {
                            replace(it);
                            throw err;
                          }
                        },
                        featured ? 'Featured on the home page.' : 'No longer featured.',
                      );
                    }}
                  />
                  Featured on the home page
                </label>
                <div className={local.row}>
                  {changed && (
                    <Button
                      type="button"
                      variant="dark"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => saveText(it)}
                    >
                      Save
                    </Button>
                  )}
                  <button
                    type="button"
                    className={local.link}
                    aria-label={`Move ${label} earlier`}
                    disabled={busy !== null || i === 0}
                    onClick={() =>
                      void run(it.id, async () =>
                        setItems((await adminMoveGalleryItem(it, 'up')).items),
                      )
                    }
                  >
                    ↑ Earlier
                  </button>
                  <button
                    type="button"
                    className={local.link}
                    aria-label={`Move ${label} later`}
                    disabled={busy !== null || i === items.length - 1}
                    onClick={() =>
                      void run(it.id, async () =>
                        setItems((await adminMoveGalleryItem(it, 'down')).items),
                      )
                    }
                  >
                    ↓ Later
                  </button>
                  <button
                    type="button"
                    className={local.link}
                    aria-label={`Delete ${label}`}
                    disabled={busy !== null}
                    onClick={() => {
                      if (!window.confirm(`Delete this ${it.type}? This can't be undone.`)) return;
                      void run(
                        it.id,
                        async () => {
                          await adminDeleteGalleryItem(it);
                          setItems((cur) => (cur ?? []).filter((x) => x.id !== it.id));
                        },
                        `Deleted the ${it.type}.`,
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
    </main>
  );
}
