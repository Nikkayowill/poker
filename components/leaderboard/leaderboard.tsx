"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import { Coins, Crown } from "lucide-react";

interface LeaderboardEntry {
  profileId: string;
  rank: number;
  displayName: string;
  accent: string;
  handsPlayed: number;
  handsWon: number;
  vpipHands: number;
  netProfit: number;
  biggestPotWon: number;
}

interface SeasonInfo {
  id: string;
  startsAt: string;
  endsAt: string;
}

type Scope = "season" | "lifetime";

function formatProfit(amount: number): string {
  const sign = amount > 0 ? "+" : "";
  return `${sign}${amount.toLocaleString()}`;
}

function daysRemaining(endsAt: string): number {
  return Math.max(0, Math.ceil((Date.parse(endsAt) - Date.now()) / 86_400_000));
}

function Row({ entry, mine }: { entry: LeaderboardEntry; mine: boolean }) {
  return (
    <div className={clsx("leaderboard-row", mine && "leaderboard-row-mine")}>
      <span className="leaderboard-rank">
        {entry.rank <= 3 ? <Crown size={14} className={`leaderboard-crown-${entry.rank}`} /> : entry.rank}
      </span>
      <span className="leaderboard-avatar" style={{ "--avatar-accent": entry.accent } as React.CSSProperties}>
        {entry.displayName.slice(0, 2).toUpperCase()}
      </span>
      <span className="leaderboard-name">{entry.displayName}{mine && <em> (you)</em>}</span>
      <span className="leaderboard-stat">{entry.handsPlayed}</span>
      <span className="leaderboard-stat">{entry.handsPlayed > 0 ? Math.round((entry.vpipHands / entry.handsPlayed) * 100) : 0}%</span>
      <span className="leaderboard-stat">{entry.biggestPotWon.toLocaleString()}</span>
      <span className={clsx("leaderboard-profit", entry.netProfit >= 0 ? "leaderboard-profit-up" : "leaderboard-profit-down")}>
        {formatProfit(entry.netProfit)}
      </span>
    </div>
  );
}

/**
 * Public rankings. Entertainment-only, same as the Gold it's built from --
 * this is the social-proof loop, not a money one.
 */
export function Leaderboard() {
  const [scope, setScope] = useState<Scope>("season");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [mine, setMine] = useState<LeaderboardEntry | null>(null);
  const [season, setSeason] = useState<SeasonInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (nextScope: Scope) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/leaderboard?scope=${nextScope}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load the leaderboard.");
      setEntries(data.entries);
      setMine(data.mine);
      setSeason(data.season);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the leaderboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(scope), 0);
    return () => window.clearTimeout(timer);
  }, [load, scope]);

  const mineIsRanked = mine !== null && entries.some((entry) => entry.profileId === mine.profileId);

  return (
    <main className="leaderboard-shell">
      <header className="leaderboard-header">
        <div>
          <div className="lobby-kicker">Standings</div>
          <h1>The leaderboard.</h1>
          {/* An em dash, not the codebase's `--` comment idiom: this string is
              rendered prose, and a double hyphen prints as a double hyphen. */}
          <p>Ranked by Gold won, not Gold bought. Entertainment only &mdash; nothing here can be cashed out.</p>
        </div>
        <Link className="leaderboard-back" href="/">← Back to the table</Link>
      </header>

      <div className="leaderboard-scope">
        <button
          type="button"
          className={clsx("leaderboard-scope-button", scope === "season" && "leaderboard-scope-active")}
          onClick={() => setScope("season")}
        >
          This season
        </button>
        <button
          type="button"
          className={clsx("leaderboard-scope-button", scope === "lifetime" && "leaderboard-scope-active")}
          onClick={() => setScope("lifetime")}
        >
          All time
        </button>
        {scope === "season" && season && (
          <span className="leaderboard-season-window">
            {daysRemaining(season.endsAt)} day{daysRemaining(season.endsAt) === 1 ? "" : "s"} left in this season
          </span>
        )}
      </div>

      {error && <p className="leaderboard-error">{error}</p>}

      {!loading && !error && entries.length === 0 && (
        <p className="leaderboard-empty">
          <Coins size={15} /> Nobody has finished a hand {scope === "season" ? "this season" : "yet"}. Be the first.
        </p>
      )}

      {entries.length > 0 && (
        <div className="leaderboard-table">
          <div className="leaderboard-row leaderboard-row-head">
            <span>#</span>
            <span />
            <span>Player</span>
            <span>Hands</span>
            <span>VPIP</span>
            <span>Best pot</span>
            <span>Net</span>
          </div>
          {entries.map((entry) => (
            <Row key={entry.profileId} entry={entry} mine={entry.profileId === mine?.profileId} />
          ))}
          {mine && !mineIsRanked && (
            <>
              <div className="leaderboard-divider" />
              <Row entry={mine} mine />
            </>
          )}
        </div>
      )}
    </main>
  );
}
