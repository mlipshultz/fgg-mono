'use client';

import { type ChangeEvent, type FormEvent, useEffect, useState } from 'react';
import type {
  AdminEvent,
  AdminVenue,
  EventImageKind,
  EventInput,
  TableBooking,
  VendorTableStatus,
} from '@fgg/types';
import { Button } from '@/components/Button';
import styles from '@/components/admin/admin.module.css';
import ui from '@/components/ui.module.css';
import {
  adminListEvents,
  adminRebuildSite,
  adminSaveEvent,
  adminSaveVenue,
  adminUploadEventImage,
} from '@/lib/api';
import { shortDateLabel, year } from '@/lib/dates';
import local from './events.module.css';

const VENDOR_STATUS: Record<VendorTableStatus, string> = {
  open: 'Open',
  closed: 'Closed',
  coming_soon: 'Coming soon',
};
const TIME_ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

interface DayDraft {
  date: string;
  opens: string;
  closes: string;
  vendorLoadIn: string;
}
/** The event form holds text so fields can be empty while they're being typed. */
interface EventDraft {
  id?: string;
  name: string;
  slug: string;
  /** Once the link is typed by hand (or the event exists) it stops following the name. */
  slugLocked: boolean;
  blurb: string;
  venueId: string;
  days: DayDraft[];
  vendorStatus: VendorTableStatus;
  vendorOpensAt: string;
  tableRate: string;
  pokeBucksRate: string;
  tableBooking: TableBooking;
  tableCapacity: string;
  posterKey?: string | undefined;
  posterUrl?: string | undefined;
  cardKey?: string | undefined;
  cardUrl?: string | undefined;
  published: boolean;
  seriesId?: string | undefined;
}
interface VenueDraft {
  id?: string;
  name: string;
  address: string;
  city: string;
  state: string;
  timeZone: string;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const dollars = (cents: number) => String(cents / 100);
/** RFC 3339 instant ↔ the value of a datetime-local input, in the browser's zone. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const newEvent = (venueId: string): EventDraft => ({
  name: '',
  slug: '',
  slugLocked: false,
  blurb: '',
  venueId,
  days: [{ date: '', opens: '11:00', closes: '17:00', vendorLoadIn: '09:00' }],
  vendorStatus: 'coming_soon',
  vendorOpensAt: '',
  tableRate: '200',
  pokeBucksRate: '100',
  tableBooking: 'floor_plan',
  tableCapacity: '',
  published: false,
});
const toDraft = (e: AdminEvent): EventDraft => ({
  id: e.id,
  name: e.name,
  slug: e.slug,
  slugLocked: true,
  blurb: e.blurb,
  venueId: e.venueId,
  days: e.days.map((d) => ({ ...d, vendorLoadIn: d.vendorLoadIn ?? '' })),
  vendorStatus: e.vendorStatus,
  vendorOpensAt: e.vendorOpensAt ? toLocalInput(e.vendorOpensAt) : '',
  tableRate: dollars(e.tableRateCents),
  pokeBucksRate: dollars(e.pokeBucksRateCents),
  tableBooking: e.tableBooking ?? 'floor_plan',
  tableCapacity: e.tableCapacity ? String(e.tableCapacity) : '',
  posterKey: e.posterKey,
  posterUrl: e.posterUrl,
  cardKey: e.cardKey,
  cardUrl: e.cardUrl,
  published: e.published,
  seriesId: e.seriesId,
});

/** The form as the API wants it, or a message about the first thing that's missing. */
function toInput(d: EventDraft): EventInput | string {
  if (!d.name.trim()) return 'Give the event a name.';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.slug))
    return 'The link can only use lowercase letters, numbers and dashes.';
  if (!d.venueId) return 'Pick a venue.';
  if (d.days.some((x) => !x.date || !x.opens || !x.closes))
    return 'Every day needs a date, an opening time and a closing time.';
  const money = (s: string) => Math.round(Number(s) * 100);
  if (![d.tableRate, d.pokeBucksRate].every((s) => s.trim() !== '' && Number(s) >= 0))
    return 'Enter the table rates in dollars.';
  const capacity = Number(d.tableCapacity);
  if (d.tableBooking === 'quantity' && !(Number.isInteger(capacity) && capacity > 0))
    return 'Say how many tables are for sale each day.';
  return {
    name: d.name.trim(),
    slug: d.slug,
    blurb: d.blurb.trim(),
    venueId: d.venueId,
    days: d.days.map((x) => ({
      date: x.date,
      opens: x.opens,
      closes: x.closes,
      ...(x.vendorLoadIn ? { vendorLoadIn: x.vendorLoadIn } : {}),
    })),
    vendorStatus: d.vendorStatus,
    ...(d.vendorOpensAt ? { vendorOpensAt: new Date(d.vendorOpensAt).toISOString() } : {}),
    tableRateCents: money(d.tableRate),
    pokeBucksRateCents: money(d.pokeBucksRate),
    tableBooking: d.tableBooking,
    ...(d.tableBooking === 'quantity' ? { tableCapacity: capacity } : {}),
    ...(d.posterKey ? { posterKey: d.posterKey } : {}),
    ...(d.cardKey ? { cardKey: d.cardKey } : {}),
    ...(d.seriesId ? { seriesId: d.seriesId } : {}),
    published: d.published,
  };
}

/** Events and venues: create, edit and publish. Public pages change after a site rebuild. */
export function EventsAdmin() {
  const [events, setEvents] = useState<AdminEvent[] | null>(null);
  const [venues, setVenues] = useState<AdminVenue[]>([]);
  const [tab, setTab] = useState<'events' | 'venues'>('events');
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [venueDraft, setVenueDraft] = useState<VenueDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    adminListEvents()
      .then((r) => {
        if (!alive) return;
        setEvents(r.events);
        setVenues(r.venues);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load events');
      });
    return () => {
      alive = false;
    };
  }, []);

  const venueOf = (id: string) => venues.find((v) => v.id === id);
  const fail = (e: unknown, fallback: string) =>
    setError(e instanceof Error ? e.message : fallback);
  const say = (msg: string) => {
    setError(null);
    setToast(msg);
  };

  const patch = (p: Partial<EventDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const patchDay = (i: number, p: Partial<DayDraft>) =>
    setDraft((d) => (d ? { ...d, days: d.days.map((x, j) => (j === i ? { ...x, ...p } : x)) } : d));
  /** A new event's link follows its name and year until someone edits the link. */
  const autoSlug = (name: string, firstDate: string) =>
    slugify(`${name} ${firstDate ? year(firstDate) : ''}`);

  const saveEvent = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!draft) return;
    const input = toInput(draft);
    if (typeof input === 'string') return setError(input);
    setBusy('event');
    setError(null);
    try {
      const saved = await adminSaveEvent(input, draft.id);
      setEvents((cur) =>
        [saved, ...(cur ?? []).filter((e) => e.id !== saved.id)].sort((a, b) =>
          b.startsAt.localeCompare(a.startsAt),
        ),
      );
      setDraft(null);
      say(
        `Saved ${saved.name}. Booking pages use it straight away; the public event pages change after a site rebuild.`,
      );
    } catch (e) {
      fail(e, 'Could not save the event');
    } finally {
      setBusy(null);
    }
  };

  const upload = async (kind: EventImageKind, ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    if (!(IMAGE_TYPES as readonly string[]).includes(file.type))
      return setError('Use a PNG, JPG or WebP image.');
    setBusy(kind);
    setError(null);
    try {
      const up = await adminUploadEventImage(file, { kind, contentType: file.type as ImageType });
      patch(
        kind === 'poster'
          ? { posterKey: up.key, posterUrl: up.url }
          : { cardKey: up.key, cardUrl: up.url },
      );
    } catch (e) {
      fail(e, 'Could not upload the image');
    } finally {
      setBusy(null);
    }
  };

  const saveVenue = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!venueDraft) return;
    const { id, ...input } = venueDraft;
    if (!input.name.trim() || !input.city.trim() || !input.state.trim())
      return setError('A venue needs a name, a city and a state.');
    setBusy('venue');
    setError(null);
    try {
      const saved = await adminSaveVenue(input, id);
      setVenues((cur) =>
        [...cur.filter((v) => v.id !== saved.id), saved].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      setVenueDraft(null);
      say(`Saved ${saved.name}.`);
    } catch (e) {
      fail(e, 'Could not save the venue');
    } finally {
      setBusy(null);
    }
  };

  const rebuild = async () => {
    setBusy('rebuild');
    setError(null);
    try {
      await adminRebuildSite();
      say('Rebuild started. Changes go live on the public site in about 5 minutes.');
    } catch (e) {
      fail(e, 'Could not start the rebuild');
    } finally {
      setBusy(null);
    }
  };

  const image = (kind: EventImageKind, label: string, hint: string) => {
    const url = kind === 'poster' ? draft?.posterUrl : draft?.cardUrl;
    return (
      <div className={local.image}>
        <b>{label}</b>
        {url ? (
          <img src={url} alt={`${label} preview`} className={local.thumb} />
        ) : (
          <span className={local.thumbEmpty}>None yet</span>
        )}
        <span className={styles.muted}>{hint}</span>
        <input
          type="file"
          accept={IMAGE_TYPES.join(',')}
          aria-label={`Upload ${label.toLowerCase()}`}
          disabled={busy === kind}
          onChange={(e) => void upload(kind, e)}
        />
        {busy === kind && <span className={styles.muted}>Uploading…</span>}
        {url && (
          <button
            type="button"
            className={local.link}
            onClick={() =>
              patch(
                kind === 'poster'
                  ? { posterKey: undefined, posterUrl: undefined }
                  : { cardKey: undefined, cardUrl: undefined },
              )
            }
          >
            Remove {label.toLowerCase()}
          </button>
        )}
      </div>
    );
  };

  const draftVenue = draft ? venueOf(draft.venueId) : undefined;

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <div>
          <span className={ui.eyebrow}>Admin</span>
          <h1 className={styles.title}>Events</h1>
        </div>
        <div className={styles.filters}>
          <div className={styles.tabs} role="group" aria-label="Section">
            {(['events', 'venues'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={styles.tab}
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
              >
                {t === 'events' ? 'Events' : 'Venues'}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy === 'rebuild'}
            onClick={() => void rebuild()}
          >
            {busy === 'rebuild' ? 'Starting…' : 'Rebuild site'}
          </Button>
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

      {tab === 'events' && draft && (
        <form className={styles.card} onSubmit={saveEvent} noValidate>
          <span className={styles.cardTitle}>{draft.id ? `Edit ${draft.name}` : 'New event'}</span>
          <div className={styles.formRow}>
            <label>
              Name
              <input
                value={draft.name}
                onChange={(e) =>
                  patch({
                    name: e.target.value,
                    ...(draft.slugLocked
                      ? {}
                      : { slug: autoSlug(e.target.value, draft.days[0]?.date ?? '') }),
                  })
                }
                placeholder="Winter Fest"
              />
            </label>
            <label>
              Link
              <input
                value={draft.slug}
                onChange={(e) => patch({ slug: e.target.value, slugLocked: true })}
                placeholder="winter-fest-2027"
              />
              <span className={styles.muted}>/events/{draft.slug || '…'}/</span>
            </label>
            <label>
              Venue
              <select value={draft.venueId} onChange={(e) => patch({ venueId: e.target.value })}>
                <option value="">Pick a venue</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {v.city}
                  </option>
                ))}
              </select>
            </label>
            <label className={local.wide}>
              About
              <textarea
                className={local.textarea}
                rows={3}
                maxLength={600}
                value={draft.blurb}
                onChange={(e) => patch({ blurb: e.target.value })}
              />
            </label>
          </div>

          <span className={styles.cardTitle}>Days</span>
          <div className={local.days}>
            {draft.days.map((d, i) => (
              <div key={i} className={`${styles.formRow} ${local.dayRow}`}>
                <label>
                  Date
                  <input
                    type="date"
                    value={d.date}
                    onChange={(e) => {
                      patchDay(i, { date: e.target.value });
                      if (i === 0 && !draft.slugLocked)
                        patch({ slug: autoSlug(draft.name, e.target.value) });
                    }}
                  />
                </label>
                <label>
                  Opens
                  <input
                    type="time"
                    value={d.opens}
                    onChange={(e) => patchDay(i, { opens: e.target.value })}
                  />
                </label>
                <label>
                  Closes
                  <input
                    type="time"
                    value={d.closes}
                    onChange={(e) => patchDay(i, { closes: e.target.value })}
                  />
                </label>
                <label>
                  Vendor load-in
                  <input
                    type="time"
                    value={d.vendorLoadIn}
                    onChange={(e) => patchDay(i, { vendorLoadIn: e.target.value })}
                  />
                </label>
                {draft.days.length > 1 && (
                  <button
                    type="button"
                    className={local.link}
                    aria-label={`Remove day ${i + 1}`}
                    onClick={() => patch({ days: draft.days.filter((_, j) => j !== i) })}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <div>
              <button
                type="button"
                className={local.link}
                onClick={() =>
                  patch({
                    days: [...draft.days, { ...draft.days[draft.days.length - 1]!, date: '' }],
                  })
                }
              >
                + Add a day
              </button>
            </div>
          </div>

          <span className={styles.cardTitle}>Vendor tables</span>
          <div className={styles.formRow}>
            <label>
              Booking
              <select
                value={draft.vendorStatus}
                onChange={(e) => patch({ vendorStatus: e.target.value as VendorTableStatus })}
              >
                {Object.entries(VENDOR_STATUS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {draft.vendorStatus === 'coming_soon' && (
              <label>
                Opens for booking (optional)
                <input
                  type="datetime-local"
                  value={draft.vendorOpensAt}
                  onChange={(e) => patch({ vendorOpensAt: e.target.value })}
                />
              </label>
            )}
            <label>
              Table rate ($ per day)
              <input
                type="number"
                min={0}
                step="any"
                value={draft.tableRate}
                onChange={(e) => patch({ tableRate: e.target.value })}
              />
            </label>
            <label>
              PokéBucks partner rate ($ per day)
              <input
                type="number"
                min={0}
                step="any"
                value={draft.pokeBucksRate}
                onChange={(e) => patch({ pokeBucksRate: e.target.value })}
              />
            </label>
            <label>
              How vendors book
              <select
                value={draft.tableBooking}
                onChange={(e) => patch({ tableBooking: e.target.value as TableBooking })}
              >
                <option value="floor_plan">On the floor plan</option>
                <option value="quantity">By number of tables</option>
              </select>
              {draft.tableBooking === 'floor_plan' && draftVenue && !draftVenue.hasFloorPlan && (
                <span className={styles.muted}>
                  {draftVenue.name} has no floor plan yet, so booking can&apos;t open this way.
                </span>
              )}
            </label>
            {draft.tableBooking === 'quantity' && (
              <label>
                Tables for sale per day
                <input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={draft.tableCapacity}
                  onChange={(e) => patch({ tableCapacity: e.target.value })}
                />
              </label>
            )}
          </div>

          <span className={styles.cardTitle}>Images</span>
          <div className={local.images}>
            {image(
              'poster',
              'Poster',
              'Shown on the event page, and on the home card if there is no card image.',
            )}
            {image('card', 'Card image', 'Optional landscape image for the home page card.')}
          </div>

          <label className={local.check}>
            <input
              type="checkbox"
              checked={draft.published}
              onChange={(e) => patch({ published: e.target.checked })}
            />
            Published (listed on the site)
          </label>
          <div className={local.formActions}>
            <Button type="submit" variant="dark" size="sm" disabled={busy !== null}>
              {busy === 'event' ? 'Saving…' : draft.id ? 'Save event' : 'Create event'}
            </Button>
            <button type="button" className={local.link} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {tab === 'events' && !draft && (
        <>
          <div>
            <Button
              type="button"
              variant="yellow"
              size="sm"
              onClick={() => {
                setToast(null);
                setDraft(newEvent(venues[0]?.id ?? ''));
              }}
            >
              New event
            </Button>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Venue</th>
                  <th>Vendor tables</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(events ?? []).map((e) => (
                  <tr key={e.id}>
                    <td>
                      <span className={styles.name}>{e.name}</span>
                      <span className={styles.sub}>
                        {shortDateLabel(e.days[0]!.date, e.days[e.days.length - 1]!.date)}{' '}
                        {year(e.days[0]!.date)}
                      </span>
                    </td>
                    <td>{venueOf(e.venueId)?.name ?? '—'}</td>
                    <td>
                      <span className={styles.name}>{VENDOR_STATUS[e.vendorStatus]}</span>
                      <span className={styles.sub}>
                        {e.tableBooking === 'quantity'
                          ? `${e.tableCapacity ?? 0} tables per day`
                          : 'Floor plan'}
                      </span>
                    </td>
                    <td>
                      <span className={styles.chip}>{e.published ? 'Published' : 'Draft'}</span>
                    </td>
                    <td>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Edit ${e.name}`}
                        onClick={() => {
                          setToast(null);
                          setError(null);
                          setDraft(toDraft(e));
                        }}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
                {events?.length === 0 && (
                  <tr>
                    <td colSpan={5} className={styles.emptyRow}>
                      No events yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {events === null && !error && <p className={styles.muted}>Loading events…</p>}
        </>
      )}

      {tab === 'venues' && venueDraft && (
        <form className={styles.card} onSubmit={saveVenue} noValidate>
          <span className={styles.cardTitle}>
            {venueDraft.id ? `Edit ${venueDraft.name}` : 'New venue'}
          </span>
          <div className={styles.formRow}>
            {(['name', 'address', 'city', 'state'] as const).map((k) => (
              <label key={k}>
                {k[0]!.toUpperCase() + k.slice(1)}
                <input
                  value={venueDraft[k]}
                  onChange={(e) => setVenueDraft({ ...venueDraft, [k]: e.target.value })}
                />
              </label>
            ))}
            <label>
              Time zone
              <select
                value={venueDraft.timeZone}
                onChange={(e) => setVenueDraft({ ...venueDraft, timeZone: e.target.value })}
              >
                {[...new Set([venueDraft.timeZone, ...TIME_ZONES])].map((z) => (
                  <option key={z} value={z}>
                    {z.replace('America/', '').replace('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={local.formActions}>
            <Button type="submit" variant="dark" size="sm" disabled={busy !== null}>
              {busy === 'venue' ? 'Saving…' : venueDraft.id ? 'Save venue' : 'Create venue'}
            </Button>
            <button type="button" className={local.link} onClick={() => setVenueDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {tab === 'venues' && !venueDraft && (
        <>
          <div>
            <Button
              type="button"
              variant="yellow"
              size="sm"
              onClick={() => {
                setToast(null);
                setVenueDraft({
                  name: '',
                  address: '',
                  city: '',
                  state: 'MD',
                  timeZone: TIME_ZONES[0]!,
                });
              }}
            >
              New venue
            </Button>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Venue</th>
                  <th>Where</th>
                  <th>Floor plan</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {venues.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <span className={styles.name}>{v.name}</span>
                    </td>
                    <td>
                      {v.address ? `${v.address}, ` : ''}
                      {v.city}, {v.state}
                    </td>
                    <td>
                      <span className={styles.chip}>{v.hasFloorPlan ? 'Yes' : 'Not yet'}</span>
                    </td>
                    <td>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Edit ${v.name}`}
                        onClick={() => {
                          setToast(null);
                          setError(null);
                          const { hasFloorPlan: _h, ...rest } = v;
                          setVenueDraft(rest);
                        }}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
