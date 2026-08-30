"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { AdminProfileSummary } from "@/lib/server/profile-store";
import { useClipboardCopy } from "@/components/use-clipboard-copy";

interface TableStats {
  publicTables: number;
  privateTables: number;
}

type PvpTableKind = "heads-up" | "cribbage" | "sit-and-go";

interface WaitingPvpTable {
  kind: PvpTableKind;
  id: string;
  hostId: string;
  hostName: string;
  stake: number;
  label: string;
  seatedCount: number;
  capacity: number;
  createdAt: string;
}

function formatAge(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function isSameUtcDay(a: Date, b: Date) {
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function AdjustGoldForm({
  profile,
  pending,
  onAdjust,
}: {
  profile: AdminProfileSummary;
  pending: boolean;
  onAdjust: (delta: number) => void;
}) {
  const [amount, setAmount] = useState("");
  const submit = (sign: 1 | -1) => {
    const parsed = Math.trunc(Number(amount));
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    onAdjust(sign * parsed);
    setAmount("");
  };
  return (
    <div className="admin-adjust">
      <input
        type="number"
        min={1}
        inputMode="numeric"
        placeholder="Amount"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        aria-label={`Adjust ${profile.displayName}'s Gold`}
      />
      <button type="button" disabled={pending || !amount} onClick={() => submit(1)} title="Add Gold">+</button>
      <button type="button" disabled={pending || !amount} onClick={() => submit(-1)} title="Subtract Gold">−</button>
    </div>
  );
}

export function AdminDashboard() {
  const [unlocked, setUnlocked] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [profiles, setProfiles] = useState<AdminProfileSummary[] | null>(null);
  const [tableStats, setTableStats] = useState<TableStats | null>(null);
  const [waitingTables, setWaitingTables] = useState<WaitingPvpTable[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState<"all" | "registered" | "guest">("all");
  const [pendingTableId, setPendingTableId] = useState<string | null>(null);
  const { copiedValue: copiedId, copy: copyId } = useClipboardCopy(1500);

  const lock = async () => {
    await fetch("/api/admin/session", { method: "DELETE" }).catch(() => null);
    setUnlocked(false);
    setProfiles(null);
    setTableStats(null);
    setWaitingTables(null);
    setSelectedIds(new Set());
    setError(null);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [profilesResponse, tablesResponse, pvpTablesResponse] = await Promise.all([
        fetch("/api/admin/profiles"),
        fetch("/api/admin/tables"),
        fetch("/api/admin/pvp-tables"),
      ]);
      const profilesData = await profilesResponse.json();
      if (!profilesResponse.ok) {
        if (profilesResponse.status === 404 || profilesResponse.status === 401) setUnlocked(false);
        throw new Error(
          profilesResponse.status === 404 || profilesResponse.status === 401
            ? "Your admin session expired. Unlock again."
            : profilesData.error,
        );
      }
      const tablesData = await tablesResponse.json();
      setProfiles(profilesData.profiles);
      setSelectedIds((current) => {
        const available = new Set<string>(
          profilesData.profiles.map((profile: AdminProfileSummary) => profile.id),
        );
        return new Set([...current].filter((id) => available.has(id)));
      });
      if (tablesResponse.ok) setTableStats(tablesData);
      if (pvpTablesResponse.ok) {
        const pvpTablesData = await pvpTablesResponse.json();
        setWaitingTables(pvpTablesData.tables);
      }
      setUnlocked(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load signups.");
      setProfiles(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/admin/session");
        if (response.ok) {
          setUnlocked(true);
          await load();
        }
      } finally {
        setCheckingSession(false);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const unlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const key = String(new FormData(form).get("secret") ?? "");
    if (!key) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: key }),
      });
      const data = await response.json();
      form.reset();
      if (!response.ok) throw new Error(data.error ?? "Could not unlock admin.");
      setUnlocked(true);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not unlock admin.");
      setUnlocked(false);
    } finally {
      setLoading(false);
    }
  };

  const toggleUnlimited = async (profile: AdminProfileSummary) => {
    setPendingId(profile.id);
    setError(null);
    try {
      const response = await fetch("/api/admin/gold/unlimited", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: profile.id, unlimited: !profile.unlimitedGold }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not update that profile.");
      setProfiles((current) => current?.map((entry) => (
        entry.id === profile.id ? { ...entry, unlimitedGold: !profile.unlimitedGold } : entry
      )) ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update that profile.");
    } finally {
      setPendingId(null);
    }
  };

  const toggleBanned = async (profile: AdminProfileSummary) => {
    setPendingId(profile.id);
    setError(null);
    try {
      const response = await fetch("/api/admin/ban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: profile.id, banned: !profile.banned }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not update that profile's ban status.");
      setProfiles((current) => current?.map((entry) => (
        entry.id === profile.id ? { ...entry, banned: !profile.banned } : entry
      )) ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update that profile's ban status.");
    } finally {
      setPendingId(null);
    }
  };

  const adjustGold = async (profile: AdminProfileSummary, delta: number) => {
    setPendingId(profile.id);
    setError(null);
    try {
      const response = await fetch("/api/admin/gold/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: profile.id, delta }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not adjust that profile's Gold.");
      setProfiles((current) => current?.map((entry) => (
        entry.id === profile.id ? { ...entry, ...data.profile } : entry
      )) ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not adjust that profile's Gold.");
    } finally {
      setPendingId(null);
    }
  };

  const removeProfiles = async (targets: AdminProfileSummary[]) => {
    if (targets.length === 0) return;
    const message = targets.length === 1
      ? `Permanently delete ${targets[0].displayName}'s profile?\n\nPurchase audit records will be retained but detached. This can't be undone.`
      : `Permanently delete ${targets.length.toLocaleString()} selected profiles?\n\nThis removes their stats, cosmetics, and profile data. Purchase audit records are retained but detached. This can't be undone.`;
    if (!window.confirm(message)) return;
    if (targets.length === 1) setPendingId(targets[0].id);
    else setBulkPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/delete-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileIds: targets.map((profile) => profile.id) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not delete the selected profiles.");
      const deleted = new Set<string>(data.deletedIds ?? []);
      setProfiles((current) => current?.filter((entry) => !deleted.has(entry.id)) ?? null);
      setSelectedIds((current) => new Set([...current].filter((id) => !deleted.has(id))));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the selected profiles.");
    } finally {
      setPendingId(null);
      setBulkPending(false);
    }
  };

  const cancelWaitingTable = async (table: WaitingPvpTable) => {
    const message = `Force-cancel this ${table.label} table hosted by ${table.hostName}?\n\n`
      + `Refunds ${(table.stake * table.seatedCount).toLocaleString()} Gold to whoever is seated. This can't be undone.`;
    if (!window.confirm(message)) return;
    setPendingTableId(table.id);
    setError(null);
    try {
      const response = await fetch("/api/admin/pvp-tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: table.kind, tableId: table.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not cancel that table.");
      setWaitingTables((current) => current?.filter((entry) => entry.id !== table.id) ?? null);
      if (data.refundFailures > 0) {
        setError(
          `Cancelled, but ${data.refundFailures} of ${table.seatedCount} refund(s) failed to post -- `
          + "check that player's Gold balance and credit it manually.",
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not cancel that table.");
    } finally {
      setPendingTableId(null);
    }
  };

  const stats = useMemo(() => {
    if (!profiles) return null;
    const now = new Date();
    const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    const confirmed = profiles.filter((profile) => profile.isRegistered);
    return {
      total: profiles.length,
      confirmed: confirmed.length,
      guests: profiles.length - confirmed.length,
      today: confirmed.filter((profile) => isSameUtcDay(new Date(profile.createdAt), now)).length,
      thisWeek: confirmed.filter((profile) => Date.parse(profile.createdAt) >= weekAgo).length,
      goldInCirculation: profiles.reduce((sum, profile) => sum + (profile.goldBalance ?? 0), 0),
    };
  }, [profiles]);

  // Admin-only signal for spotting multiple accounts played from the same
  // address (collusion/chip dumping): purely a client-side grouping over
  // data already fetched, no separate detection service.
  const ipCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const profile of profiles ?? []) {
      if (!profile.lastSeenIp) continue;
      counts.set(profile.lastSeenIp, (counts.get(profile.lastSeenIp) ?? 0) + 1);
    }
    return counts;
  }, [profiles]);

  const filtered = useMemo(() => {
    if (!profiles) return [];
    const needle = query.trim().toLowerCase();
    return profiles.filter((profile) => {
      if (accountFilter === "registered" && !profile.isRegistered) return false;
      if (accountFilter === "guest" && profile.isRegistered) return false;
      if (!needle) return true;
      return profile.displayName.toLowerCase().includes(needle) || profile.id.toLowerCase().includes(needle);
    });
  }, [profiles, query, accountFilter]);

  const selectedProfiles = useMemo(
    () => (profiles ?? []).filter((profile) => selectedIds.has(profile.id)),
    [profiles, selectedIds],
  );
  const allFilteredSelected = filtered.length > 0
    && filtered.every((profile) => selectedIds.has(profile.id));
  const toggleSelected = (profileId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  };
  const toggleAllFiltered = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allFilteredSelected) filtered.forEach((profile) => next.delete(profile.id));
      else filtered.forEach((profile) => next.add(profile.id));
      return next;
    });
  };

  if (checkingSession) {
    return (
      <main className="admin-shell admin-locked">
        <div className="admin-unlock admin-session-check">
          <p className="admin-eyebrow">StackChips / Operations</p>
          <h1>Checking secure session…</h1>
        </div>
      </main>
    );
  }

  if (!unlocked) {
    return (
      <main className="admin-shell admin-locked">
        <form
          className="admin-unlock"
          onSubmit={(event) => void unlock(event)}
        >
          <div className="admin-brand" aria-hidden="true"><span>S</span></div>
          <p className="admin-eyebrow">StackChips / Operations</p>
          <h1>Admin console</h1>
          <p className="admin-subtitle">Private tools for player support, moderation, and the Gold economy.</p>
          <label htmlFor="admin-secret">Admin key</label>
          <input
            id="admin-secret"
            name="secret"
            type="password"
            autoComplete="current-password"
            placeholder="Paste ADMIN_SECRET"
          />
          <small className="admin-security-note">
            Exchanged once for a four-hour HttpOnly session, then cleared from this page.
          </small>
          <button type="submit" disabled={loading}>
            {loading ? "Checking…" : "Unlock"}
          </button>
          {error && <p className="admin-error">{error}</p>}
        </form>
      </main>
    );
  }

  if (!profiles) {
    return (
      <main className="admin-shell admin-locked">
        <div className="admin-unlock">
          <p className="admin-eyebrow">StackChips / Operations</p>
          <h1>Couldn’t load operations</h1>
          {error && <p className="admin-error">{error}</p>}
          <button type="button" onClick={() => void load()} disabled={loading}>
            {loading ? "Retrying…" : "Retry"}
          </button>
          <button type="button" className="admin-lock" onClick={() => void lock()}>Lock session</button>
        </div>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <p className="admin-eyebrow">StackChips / Operations</p>
          <h1>Admin console</h1>
          <p className="admin-subtitle">Player support, moderation, and table health.</p>
        </div>
        <div className="admin-header-actions">
          <Link className="admin-back" href="/">← Back to the table</Link>
          <button
            type="button"
            className="admin-refresh"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" className="admin-lock" onClick={() => void lock()}>Lock</button>
        </div>
      </header>
      {error && <p className="admin-error">{error}</p>}
      {stats && (
        <section className="admin-section" aria-labelledby="overview-heading">
          <div className="admin-section-heading">
            <div>
              <h2 id="overview-heading">Overview</h2>
              <p>Quick signals from the current player and table data.</p>
            </div>
          </div>
          <div className="admin-stats">
          <div className="admin-stat" title="Every profile, guest sessions included.">
            <span>Total players</span>
            <strong>{stats.total.toLocaleString()}</strong>
          </div>
          <div className="admin-stat" title="Signed in with Google or email -- a real account, not a browser session.">
            <span>Confirmed accounts</span>
            <strong>{stats.confirmed.toLocaleString()}</strong>
          </div>
          <div className="admin-stat" title="Playing without signing in. Progress lives only in this browser.">
            <span>Guest profiles</span>
            <strong>{stats.guests.toLocaleString()}</strong>
          </div>
          <div className="admin-stat" title="Confirmed accounts created today, not guest sessions.">
            <span>Signups today</span>
            <strong>{stats.today.toLocaleString()}</strong>
          </div>
          <div className="admin-stat" title="Confirmed accounts created in the last 7 days, not guest sessions.">
            <span>Signups, last 7 days</span>
            <strong>{stats.thisWeek.toLocaleString()}</strong>
          </div>
          <div className="admin-stat" title="Sum of every profile's Gold balance -- watch this for economy inflation.">
            <span>Gold in circulation</span>
            <strong>{stats.goldInCirculation.toLocaleString()}</strong>
          </div>
          {tableStats && (
            <>
              <div className="admin-stat">
                <span>Public tables</span>
                <strong>{tableStats.publicTables.toLocaleString()}</strong>
              </div>
              <div className="admin-stat">
                <span>Private tables</span>
                <strong>{tableStats.privateTables.toLocaleString()}</strong>
              </div>
            </>
          )}
          </div>
        </section>
      )}
      <section className="admin-section" aria-labelledby="pvp-tables-heading">
        <div className="admin-section-heading">
          <div>
            <h2 id="pvp-tables-heading">Waiting PvP tables</h2>
            <p>
              Heads-Up, Cribbage, and Sit &amp; Go tables still waiting for an opponent. Nothing
              sweeps these automatically -- a table a host abandoned before it dealt sits here
              forever, locking their stake, until you cancel it.
            </p>
          </div>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Game</th>
                <th>Host</th>
                <th>Stake</th>
                <th>Seated</th>
                <th>Waiting</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(waitingTables ?? []).map((table) => (
                <tr key={table.id}>
                  <td>{table.label}</td>
                  <td>{table.hostName}</td>
                  <td>{table.stake.toLocaleString()}</td>
                  <td>{table.seatedCount}/{table.capacity}</td>
                  <td>{formatAge(table.createdAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="admin-delete"
                      disabled={pendingTableId === table.id}
                      onClick={() => void cancelWaitingTable(table)}
                    >
                      {pendingTableId === table.id ? "Cancelling…" : "Cancel & refund"}
                    </button>
                  </td>
                </tr>
              ))}
              {(waitingTables ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="admin-empty">No tables are waiting for an opponent right now.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="admin-section" aria-labelledby="players-heading">
        <div className="admin-section-heading admin-player-heading">
          <div>
            <h2 id="players-heading">Players</h2>
            <p>{filtered.length.toLocaleString()} of {(profiles?.length ?? 0).toLocaleString()} profiles shown.</p>
          </div>
          <div className="admin-player-controls">
            <div className="admin-account-filter" role="group" aria-label="Filter by account type">
              {([
                ["all", "All"],
                ["registered", "Confirmed"],
                ["guest", "Guests"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={accountFilter === value ? "admin-filter-active" : undefined}
                  onClick={() => setAccountFilter(value)}
                  aria-pressed={accountFilter === value}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              type="search"
              className="admin-search"
              placeholder="Search by name or Player ID…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search players"
            />
          </div>
        </div>
        <div className="admin-bulk-bar" aria-live="polite">
          <strong>{selectedProfiles.length.toLocaleString()} selected</strong>
          <span>Selection follows your search, so you can delete a filtered group in one operation.</span>
          <div>
            <button type="button" onClick={toggleAllFiltered} disabled={filtered.length === 0 || bulkPending}>
              {allFilteredSelected
                ? "Clear visible"
                : `Select all ${filtered.length.toLocaleString()} visible`}
            </button>
            {selectedProfiles.length > 0 && (
              <button
                type="button"
                className="admin-clear-selection"
                onClick={() => setSelectedIds(new Set())}
                disabled={bulkPending}
              >
                Clear selection
              </button>
            )}
            <button
              type="button"
              className="admin-bulk-delete"
              disabled={selectedProfiles.length === 0 || bulkPending || pendingId !== null}
              onClick={() => void removeProfiles(selectedProfiles)}
            >
              {bulkPending ? "Deleting…" : `Delete ${selectedProfiles.length.toLocaleString()}`}
            </button>
          </div>
        </div>
        <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th className="admin-select-cell">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleAllFiltered}
                  disabled={filtered.length === 0 || bulkPending}
                  aria-label={allFilteredSelected ? "Clear all visible profiles" : "Select all visible profiles"}
                />
              </th>
              <th>Player</th>
              <th>Account</th>
              <th>Player ID</th>
              <th>Joined</th>
              <th>Gold</th>
              <th>Unlimited</th>
              <th>Adjust Gold</th>
              <th>Banned</th>
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((profile) => {
              const ipCount = profile.lastSeenIp ? ipCounts.get(profile.lastSeenIp) ?? 0 : 0;
              return (
                <tr key={profile.id} className={selectedIds.has(profile.id) ? "admin-row-selected" : undefined}>
                  <td className="admin-select-cell">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(profile.id)}
                      onChange={() => toggleSelected(profile.id)}
                      disabled={bulkPending || pendingId === profile.id}
                      aria-label={`Select ${profile.displayName}`}
                    />
                  </td>
                  <td>{profile.displayName}</td>
                  <td>
                    <span className={profile.isRegistered ? "admin-account-registered" : "admin-account-guest"}>
                      {profile.isRegistered ? "Confirmed" : "Guest"}
                    </span>
                  </td>
                  <td>
                    <button type="button" className="admin-id-copy" onClick={() => void copyId(profile.id)}>
                      <code>{profile.id.slice(0, 8)}…</code>
                      <span>{copiedId === profile.id ? "Copied!" : "Copy"}</span>
                    </button>
                    {ipCount > 1 && (
                      <span
                        className="admin-flag"
                        title={`${ipCount} profiles have joined a table from this same IP address.`}
                      >
                        Shares IP ×{ipCount}
                      </span>
                    )}
                  </td>
                  <td>{formatDate(profile.createdAt)}</td>
                  <td>{(profile.goldBalance ?? 0).toLocaleString()}</td>
                  <td>{profile.unlimitedGold ? "Yes" : "No"}</td>
                  <td>
                    <AdjustGoldForm
                      profile={profile}
                      pending={bulkPending || pendingId === profile.id}
                      onAdjust={(delta) => void adjustGold(profile, delta)}
                    />
                  </td>
                  <td>{profile.banned ? "Yes" : "No"}</td>
                  <td>
                    <button
                      type="button"
                      className="admin-toggle"
                      disabled={bulkPending || pendingId === profile.id}
                      onClick={() => void toggleUnlimited(profile)}
                    >
                      {profile.unlimitedGold ? "Revoke" : "Grant unlimited"}
                    </button>
                    <button
                      type="button"
                      className="admin-ban"
                      disabled={bulkPending || pendingId === profile.id}
                      onClick={() => void toggleBanned(profile)}
                    >
                      {profile.banned ? "Unban" : "Ban"}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="admin-delete"
                      disabled={bulkPending || pendingId === profile.id}
                      onClick={() => void removeProfiles([profile])}
                    >
                      {pendingId === profile.id ? "Deleting…" : "Delete"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="admin-empty">No players match &ldquo;{query}&rdquo;.</td>
              </tr>
            )}

          </tbody>
        </table>
        </div>
      </section>
    </main>
  );
}
