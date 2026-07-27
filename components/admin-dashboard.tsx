"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlayerProfile } from "@/lib/profile/types";

const SECRET_STORAGE_KEY = "river-room-admin-secret";

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

export function AdminDashboard() {
  const [secret, setSecret] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [profiles, setProfiles] = useState<PlayerProfile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async (key: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/profiles", { headers: { "x-admin-secret": key } });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 404 ? "Invalid admin key." : data.error);
      setProfiles(data.profiles);
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

  const toggleUnlimited = async (profile: PlayerProfile) => {
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

  const stats = useMemo(() => {
    if (!profiles) return null;
    const now = new Date();
    const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    return {
      total: profiles.length,
      today: profiles.filter((profile) => isSameUtcDay(new Date(profile.createdAt), now)).length,
      thisWeek: profiles.filter((profile) => Date.parse(profile.createdAt) >= weekAgo).length,
    };
  }, [profiles]);

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
        <button
          type="button"
          className="admin-refresh"
          onClick={() => void load(secret)}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
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
        </div>
      )}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Player ID</th>
              <th>Joined</th>
              <th>Gold</th>
              <th>Unlimited</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => (
              <tr key={profile.id}>
                <td>{profile.displayName}</td>
                <td><code>{profile.id}</code></td>
                <td>{formatDate(profile.createdAt)}</td>
                <td>{profile.goldBalance.toLocaleString()}</td>
                <td>{profile.unlimitedGold ? "Yes" : "No"}</td>
                <td>
                  <button
                    type="button"
                    className="admin-toggle"
                    disabled={pendingId === profile.id}
                    onClick={() => void toggleUnlimited(profile)}
                  >
                    {profile.unlimitedGold ? "Revoke" : "Grant unlimited"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
