"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { AdminProfileSummary } from "@/lib/server/profile-store";

const SECRET_STORAGE_KEY = "river-room-admin-secret";

interface TableStats {
  publicTables: number;
  privateTables: number;
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
  const [secret, setSecret] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [profiles, setProfiles] = useState<AdminProfileSummary[] | null>(null);
  const [tableStats, setTableStats] = useState<TableStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async (key: string) => {
    setLoading(true);
    setError(null);
    try {
      const headers = { "x-admin-secret": key };
      const [profilesResponse, tablesResponse] = await Promise.all([
        fetch("/api/admin/profiles", { headers }),
        fetch("/api/admin/tables", { headers }),
      ]);
      const profilesData = await profilesResponse.json();
      if (!profilesResponse.ok) {
        throw new Error(profilesResponse.status === 404 ? "Invalid admin key." : profilesData.error);
      }
      const tablesData = await tablesResponse.json();
      setProfiles(profilesData.profiles);
      if (tablesResponse.ok) setTableStats(tablesData);
      window.sessionStorage.setItem(SECRET_STORAGE_KEY, key);
      setSecret(key);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load signups.");
      setProfiles(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.sessionStorage.getItem(SECRET_STORAGE_KEY);
      if (stored) void load(stored);
    }, 0);
    return () => window.clearTimeout(timer);
    // Deliberately mount-only -- `load` is stable (empty dep array), and
    // re-running this on every render would replay the stored key forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleUnlimited = async (profile: AdminProfileSummary) => {
    setPendingId(profile.id);
    setError(null);
    try {
      const response = await fetch("/api/admin/gold/unlimited", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
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
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
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
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
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

  const removeProfile = async (profile: AdminProfileSummary) => {
    if (!window.confirm(`Permanently delete ${profile.displayName}'s profile? This can't be undone.`)) return;
    setPendingId(profile.id);
    setError(null);
    try {
      const response = await fetch("/api/admin/delete-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({ profileId: profile.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not delete that profile.");
      setProfiles((current) => current?.filter((entry) => entry.id !== profile.id) ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete that profile.");
    } finally {
      setPendingId(null);
    }
  };

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
    } catch {
      // Clipboard access can be denied by browser policy; the id is still visible to copy by hand.
    }
  };

  const stats = useMemo(() => {
    if (!profiles) return null;
    const now = new Date();
    const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    return {
      total: profiles.length,
      today: profiles.filter((profile) => isSameUtcDay(new Date(profile.createdAt), now)).length,
      thisWeek: profiles.filter((profile) => Date.parse(profile.createdAt) >= weekAgo).length,
      goldInCirculation: profiles.reduce((sum, profile) => sum + (profile.goldBalance ?? 0), 0),
    };
  }, [profiles]);

  // Admin-only signal for spotting multiple accounts played from the same
  // address (collusion/chip dumping) -- purely a client-side grouping over
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
    if (!needle) return profiles;
    return profiles.filter((profile) => (
      profile.displayName.toLowerCase().includes(needle) || profile.id.toLowerCase().includes(needle)
    ));
  }, [profiles, query]);

  if (!profiles) {
    return (
      <main className="admin-shell admin-locked">
        <form
          className="admin-unlock"
          onSubmit={(event) => {
            event.preventDefault();
            void load(secretInput);
          }}
        >
          <h1>River Room admin</h1>
          <label htmlFor="admin-secret">Admin key</label>
          <input
            id="admin-secret"
            type="password"
            autoComplete="off"
            value={secretInput}
            onChange={(event) => setSecretInput(event.target.value)}
            placeholder="Paste ADMIN_SECRET"
          />
          <button type="submit" disabled={loading || !secretInput}>
            {loading ? "Checking…" : "Unlock"}
          </button>
          {error && <p className="admin-error">{error}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <h1>River Room admin</h1>
        <div className="admin-header-actions">
          <Link className="admin-back" href="/">← Back to the table</Link>
          <button
            type="button"
            className="admin-refresh"
            onClick={() => void load(secret)}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>
      {error && <p className="admin-error">{error}</p>}
      {stats && (
        <div className="admin-stats">
          <div className="admin-stat">
            <span>Total signups</span>
            <strong>{stats.total.toLocaleString()}</strong>
          </div>
          <div className="admin-stat">
            <span>Today</span>
            <strong>{stats.today.toLocaleString()}</strong>
          </div>
          <div className="admin-stat">
            <span>Last 7 days</span>
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
      )}
      <input
        type="search"
        className="admin-search"
        placeholder="Search by name or Player ID…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search players"
      />
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Player</th>
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
                <tr key={profile.id}>
                  <td>{profile.displayName}</td>
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
                      pending={pendingId === profile.id}
                      onAdjust={(delta) => void adjustGold(profile, delta)}
                    />
                  </td>
                  <td>{profile.banned ? "Yes" : "No"}</td>
                  <td>
                    <button
                      type="button"
                      className="admin-toggle"
                      disabled={pendingId === profile.id}
                      onClick={() => void toggleUnlimited(profile)}
                    >
                      {profile.unlimitedGold ? "Revoke" : "Grant unlimited"}
                    </button>
                    <button
                      type="button"
                      className="admin-ban"
                      disabled={pendingId === profile.id}
                      onClick={() => void toggleBanned(profile)}
                    >
                      {profile.banned ? "Unban" : "Ban"}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="admin-delete"
                      disabled={pendingId === profile.id}
                      onClick={() => void removeProfile(profile)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="admin-empty">No players match &ldquo;{query}&rdquo;.</td>
              </tr>
            )}

          </tbody>
        </table>
      </div>
    </main>
  );
}
