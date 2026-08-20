"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import { Coins, Crown } from "lucide-react";
import type { LeaderboardColumn } from "@/lib/leaderboard/contract";
import { leaderboardTabs } from "@/lib/leaderboard/contract";
import { selectSound } from "@/lib/audio/ui-sounds";

interface PokerEntry {
  profileId: string;
  rank: number;
  displayName: string;
  accent: string;
  handsPlayed: number;
  handsWon: number;
  vpipHands: number;
  netProfit: number;
  biggestPotWon: number;
  totalChipsWon: number;
}

interface GenericEntry {
  profileId: string;
  rank: number;
  displayName: string;
  accent: string;
  cells: Record<string, string>;
}

interface GlobalEntry {
  profileId: string;
  rank: number;
  displayName: string;
  accent: string;
  globalScore: number;
  gamesCounted: number;
}

interface SeasonInfo {
  id: string;
  startsAt: string;
  endsAt: string;
}

type Scope = "season" | "lifetime";
/** "poker" and "global" are always offered; every other id comes from lib/leaderboard/contract.ts. */
type Game = string;

const TABS = leaderboardTabs();

function formatProfit(amount: number): string {
  const sign = amount > 0 ? "+" : "";
  return `${sign}${amount.toLocaleString()}`;
}

function daysRemaining(endsAt: string): number {
  return Math.max(0, Math.ceil((Date.parse(endsAt) - Date.now()) / 86_400_000));
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <span className="leaderboard-rank">
      {rank <= 3 ? <Crown size={14} className={`leaderboard-crown-${rank}`} /> : rank}
    </span>
  );
}

function Avatar({ displayName, accent }: { displayName: string; accent: string }) {
  return (
    <span className="leaderboard-avatar" style={{ "--avatar-accent": accent } as React.CSSProperties}>
      {displayName.slice(0, 2).toUpperCase()}
    </span>
  );
}

function PokerRow({ entry, mine, scope }: { entry: PokerEntry; mine: boolean; scope: Scope }) {
  return (
    <div className={clsx("leaderboard-row", mine && "leaderboard-row-mine")}>
      <RankBadge rank={entry.rank} />
      <Avatar displayName={entry.displayName} accent={entry.accent} />
      <span className="leaderboard-name">{entry.displayName}{mine && <em> (you)</em>}</span>
      <span className="leaderboard-stat">{entry.handsPlayed}</span>
      <span className="leaderboard-stat">{entry.handsPlayed > 0 ? Math.round((entry.vpipHands / entry.handsPlayed) * 100) : 0}%</span>
      <span className="leaderboard-stat">{entry.biggestPotWon.toLocaleString()}</span>
      {/* All time is ranked by Gold won (never nets out a loss, so it is the
          board's actual sort key); a season resets every 30 days and is
          ranked by net profit for that window instead, which can go
          negative. Same column slot, different stat, so the grid never
          needs a scope-conditional column count. */}
      {scope === "lifetime" ? (
        <span className="leaderboard-profit leaderboard-profit-up">{entry.totalChipsWon.toLocaleString()}</span>
      ) : (
        <span className={clsx("leaderboard-profit", entry.netProfit >= 0 ? "leaderboard-profit-up" : "leaderboard-profit-down")}>
          {formatProfit(entry.netProfit)}
        </span>
      )}
    </div>
  );
}

/**
 * Renders whatever columns a game's contract named -- this, plus the API
 * pre-formatting each cell server-side via the contract's own formatRow, is
 * what lets a future game join the leaderboard with no new UI code.
 */
function GenericRow({ entry, mine, columns }: { entry: GenericEntry; mine: boolean; columns: LeaderboardColumn[] }) {
  return (
    <div className={clsx("leaderboard-row", "leaderboard-row-generic", `leaderboard-row-generic-${columns.length}`, mine && "leaderboard-row-mine")}>
      <RankBadge rank={entry.rank} />
      <Avatar displayName={entry.displayName} accent={entry.accent} />
      <span className="leaderboard-name">{entry.displayName}{mine && <em> (you)</em>}</span>
      {columns.map((column) => (
        <span key={column.key} className="leaderboard-stat">{entry.cells[column.key] ?? "—"}</span>
      ))}
    </div>
  );
}

function GlobalRow({ entry, mine }: { entry: GlobalEntry; mine: boolean }) {
  return (
    <div className={clsx("leaderboard-row", "leaderboard-row-generic", "leaderboard-row-generic-2", mine && "leaderboard-row-mine")}>
      <RankBadge rank={entry.rank} />
      <Avatar displayName={entry.displayName} accent={entry.accent} />
      <span className="leaderboard-name">{entry.displayName}{mine && <em> (you)</em>}</span>
      <span className="leaderboard-stat">{Math.round(entry.globalScore * 100)}</span>
      <span className="leaderboard-stat">{entry.gamesCounted}</span>
    </div>
  );
}

/**
 * Public rankings. Entertainment-only, same as the Gold it's built from --
 * this is the social-proof loop, not a money one.
 */
export function Leaderboard() {
  const [game, setGame] = useState<Game>("poker");
  const [scope, setScope] = useState<Scope>("season");
  const [pokerEntries, setPokerEntries] = useState<PokerEntry[]>([]);
  const [pokerMine, setPokerMine] = useState<PokerEntry | null>(null);
  const [season, setSeason] = useState<SeasonInfo | null>(null);
  const [genericColumns, setGenericColumns] = useState<LeaderboardColumn[]>([]);
  const [genericLabel, setGenericLabel] = useState<string>("");
  const [genericEntries, setGenericEntries] = useState<GenericEntry[]>([]);
  const [genericMine, setGenericMine] = useState<GenericEntry | null>(null);
  const [globalEntries, setGlobalEntries] = useState<GlobalEntry[]>([]);
  const [globalMine, setGlobalMine] = useState<GlobalEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (nextGame: Game, nextScope: Scope) => {
    setLoading(true);
    setError(null);
    try {
      const params = nextGame === "poker" ? `game=poker&scope=${nextScope}` : `game=${nextGame}`;
      const response = await fetch(`/api/leaderboard?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load the leaderboard.");

      if (nextGame === "poker") {
        setPokerEntries(data.entries);
        setPokerMine(data.mine);
        setSeason(data.season);
      } else if (nextGame === "global") {
        setGlobalEntries(data.entries);
        setGlobalMine(data.mine);
      } else {
        setGenericColumns(data.columns ?? []);
        setGenericLabel(data.label ?? "");
        setGenericEntries(data.entries);
        setGenericMine(data.mine);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the leaderboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(game, scope), 0);
    return () => window.clearTimeout(timer);
  }, [load, game, scope]);

  const entries = game === "poker" ? pokerEntries : game === "global" ? globalEntries : genericEntries;
  const mineId = game === "poker" ? pokerMine?.profileId : game === "global" ? globalMine?.profileId : genericMine?.profileId;
  const mineIsRanked = mineId !== undefined && entries.some((entry) => entry.profileId === mineId);
  const empty = !loading && !error && entries.length === 0;

  return (
    <main className="leaderboard-shell">
      <header className="leaderboard-header">
        <div>
          <div className="lobby-kicker">Standings</div>
          <h1>The leaderboard.</h1>
          {/* An em dash, not the codebase's `--` comment idiom: this string is
              rendered prose, and a double hyphen prints as a double hyphen. */}
          <p>
            {game === "poker"
              ? (scope === "lifetime"
                ? "All time, ranked by total Gold won — never nets out a loss."
                : "This season, ranked by net Gold won. Resets every 30 days.")
              : game === "global"
                ? "One rank across every game, blended from where you stand in each."
                : `${genericLabel || "This game"}'s own board.`}{" "}
            Entertainment only &mdash; nothing here can be cashed out.
          </p>
        </div>
        <Link className="leaderboard-back" href="/">← Back to the table</Link>
      </header>

      <div className="leaderboard-game-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={clsx("leaderboard-game-tab", game === tab.id && "leaderboard-game-tab-active")}
            onClick={() => { selectSound(); setGame(tab.id); }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {game === "poker" && (
        <div className="leaderboard-scope">
          <button
            type="button"
            className={clsx("leaderboard-scope-button", scope === "season" && "leaderboard-scope-active")}
            onClick={() => { selectSound(); setScope("season"); }}
          >
            This season
          </button>
          <button
            type="button"
            className={clsx("leaderboard-scope-button", scope === "lifetime" && "leaderboard-scope-active")}
            onClick={() => { selectSound(); setScope("lifetime"); }}
          >
            All time
          </button>
          {scope === "season" && season && (
            <span className="leaderboard-season-window">
              {daysRemaining(season.endsAt)} day{daysRemaining(season.endsAt) === 1 ? "" : "s"} left in this season
            </span>
          )}
        </div>
      )}

      {error && <p className="leaderboard-error">{error}</p>}

      {empty && (
        <p className="leaderboard-empty">
          <Coins size={15} />{" "}
          {game === "poker"
            ? `Nobody has finished a hand ${scope === "season" ? "this season" : "yet"}. Be the first.`
            : "Nobody has qualified yet. Be the first."}
        </p>
      )}

      {game === "poker" && pokerEntries.length > 0 && (
        <div className="leaderboard-table">
          <div className="leaderboard-row leaderboard-row-head">
            <span>#</span>
            <span />
            <span>Player</span>
            <span>Hands</span>
            <span>VPIP</span>
            <span>Best pot</span>
            <span>{scope === "lifetime" ? "Gold won" : "Net"}</span>
          </div>
          {pokerEntries.map((entry) => (
            <PokerRow key={entry.profileId} entry={entry} mine={entry.profileId === pokerMine?.profileId} scope={scope} />
          ))}
          {pokerMine && !mineIsRanked && (
            <>
              <div className="leaderboard-divider" />
              <PokerRow entry={pokerMine} mine scope={scope} />
            </>
          )}
        </div>
      )}

      {game === "global" && globalEntries.length > 0 && (
        <div className="leaderboard-table">
          <div className={clsx("leaderboard-row", "leaderboard-row-head", "leaderboard-row-generic", "leaderboard-row-generic-2")}>
            <span>#</span>
            <span />
            <span>Player</span>
            <span>Score</span>
            <span>Games</span>
          </div>
          {globalEntries.map((entry) => (
            <GlobalRow key={entry.profileId} entry={entry} mine={entry.profileId === globalMine?.profileId} />
          ))}
          {globalMine && !mineIsRanked && (
            <>
              <div className="leaderboard-divider" />
              <GlobalRow entry={globalMine} mine />
            </>
          )}
        </div>
      )}

      {game !== "poker" && game !== "global" && genericEntries.length > 0 && (
        <div className="leaderboard-table">
          <div className={clsx("leaderboard-row", "leaderboard-row-head", "leaderboard-row-generic", `leaderboard-row-generic-${genericColumns.length}`)}>
            <span>#</span>
            <span />
            <span>Player</span>
            {genericColumns.map((column) => <span key={column.key}>{column.label}</span>)}
          </div>
          {genericEntries.map((entry) => (
            <GenericRow key={entry.profileId} entry={entry} mine={entry.profileId === genericMine?.profileId} columns={genericColumns} />
          ))}
          {genericMine && !mineIsRanked && (
            <>
              <div className="leaderboard-divider" />
              <GenericRow entry={genericMine} mine columns={genericColumns} />
            </>
          )}
        </div>
      )}
    </main>
  );
}
