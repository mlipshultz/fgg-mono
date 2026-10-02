'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import type { AdminUserRow, Role } from '@fgg/types';
import { Button } from '@/components/Button';
import { useAuth } from '@/components/Providers';
import ui from '@/components/ui.module.css';
import { adminListUsers, adminSetRoles, hasApi } from '@/lib/api';
import { isSuperAdmin, ROLES } from '@/lib/auth';
import styles from './page.module.css';

const ROLE_LABEL: Record<Role, string> = {
  attendee: 'Attendee',
  vendor_applicant: 'Applicant',
  vendor: 'Vendor',
  staff: 'Staff',
  superadmin: 'Super admin',
};

function memberSince(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function UsersAdmin() {
  const { user } = useAuth();
  const canEdit = isSuperAdmin(user) || !hasApi;
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Role[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (email: string, next?: string) => {
    setBusy(true);
    setError(null);
    try {
      const page = await adminListUsers({
        ...(email ? { email } : {}),
        ...(next ? { cursor: next } : {}),
      });
      setRows((cur) => (next ? [...cur, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load users');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  const search = (ev: FormEvent) => {
    ev.preventDefault();
    const email = query.trim().toLowerCase();
    setActive(email);
    void load(email);
  };

  const startEdit = (row: AdminUserRow) => {
    setEditing(row.sub);
    setDraft(row.roles);
  };

  const toggleRole = (r: Role) =>
    setDraft((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  const save = async (sub: string) => {
    if (draft.length === 0) return setError('A user needs at least one role.');
    setSaving(true);
    setError(null);
    try {
      const updated = await adminSetRoles(sub, draft);
      setRows((cur) => cur.map((r) => (r.sub === sub ? updated : r)));
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save roles');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <div>
          <span className={ui.eyebrow}>Admin</span>
          <h1 className={styles.title}>Users</h1>
        </div>
        <form className={styles.search} onSubmit={search} role="search">
          <input
            type="email"
            className={styles.input}
            placeholder="Find by exact email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Find a user by exact email"
          />
          <Button type="submit" variant="yellow" size="sm" disabled={busy}>
            Search
          </Button>
          {active && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setQuery('');
                setActive('');
                void load('');
              }}
            >
              Clear
            </Button>
          )}
        </form>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>User</th>
              <th>Roles</th>
              <th>Member since</th>
              {canEdit && <th className={styles.srOnly}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.sub}>
                <td>
                  <span className={styles.name}>{row.displayName}</span>
                  <span className={styles.email}>{row.email}</span>
                </td>
                <td>
                  {editing === row.sub ? (
                    <div className={styles.chips}>
                      {ROLES.map((r) => (
                        <button
                          key={r}
                          type="button"
                          className={styles.chip}
                          aria-pressed={draft.includes(r)}
                          onClick={() => toggleRole(r)}
                        >
                          {ROLE_LABEL[r]}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.chips}>
                      {row.roles.map((r) => (
                        <span key={r} className={`${styles.roleChip} ${styles[`role_${r}`] ?? ''}`}>
                          {ROLE_LABEL[r]}
                        </span>
                      ))}
                      {row.vendorId && (
                        <span className={styles.vendorId}>vendor {row.vendorId.slice(-6)}</span>
                      )}
                    </div>
                  )}
                </td>
                <td className={styles.since}>{memberSince(row.memberSince)}</td>
                {canEdit && (
                  <td className={styles.actions}>
                    {editing === row.sub ? (
                      <>
                        <Button
                          type="button"
                          variant="dark"
                          size="sm"
                          disabled={saving}
                          onClick={() => void save(row.sub)}
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={saving}
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => startEdit(row)}
                        disabled={editing !== null}
                      >
                        Edit roles
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && !busy && (
              <tr>
                <td colSpan={canEdit ? 4 : 3} className={styles.emptyRow}>
                  {active ? `No user with the email ${active}.` : 'No users yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.foot}>
        {busy && <span className={styles.muted}>Loading…</span>}
        {cursor && !busy && (
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => void load(active, cursor)}
          >
            Load more
          </Button>
        )}
        {!canEdit && <span className={styles.muted}>Only super admins can change roles.</span>}
      </div>
    </main>
  );
}
