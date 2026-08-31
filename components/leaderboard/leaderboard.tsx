"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import { ChevronDown, Coins, Crown } from "lucide-react";
import type { LeaderboardColumn } from "@/lib/leaderboard/contract";
import { formatRecord, formatStreak, leaderboardTabs } from "@/lib/leaderboard/contract";
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

/** How close the viewer is to qualifying for a game's own board. See mineProgress on GET /api/leaderboard. */
interface QualifyProgress {
  sample: number;
  minSample: number;
}

interface GlobalEntry {
  profileId: string;
  rank: number;
  displayName: string;
  accent: string;
  globalScore: number;
  gamesCounted: number;
}

/** One friend on the Friends tab: your record against them, not theirs against the world. */
interface FriendEntry {
  profileId: string;
  displayName: string;
  accent: string;
  wins: number;
  losses: number;
  draws: number;
  currentStreak: number;
  bestStreak: number;
  games: { gameId: string; label: string; wins: number; losses: number; draws: number; currentStreak: number }[];
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

/** "Play 2 more games to qualify for this board." The gap between a played-once row and appearing on it. */
function qualifyHint(progress: QualifyProgress): string {
  const remaining = progress.minSample - progress.sample;
  return `Play ${remaining} more game${remaining === 1 ? "" : "s"} to qualify for this board.`;
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

function played(entry: { wins: number; losses: number; draws: number }): number {
  return entry.wins + entry.losses + entry.draws;
}

function winRatePct(entry: { wins: number; losses: number; draws: number }): number {
  const total = played(entry);
  return total > 0 ? Math.round((entry.wins / total) * 100) : 0;
}

/**
 * One friend, expandable into the per-game split behind the totals.
 *
 * The whole row is the button rather than a separate chevron control: the
 * split is the point of the row, and a 14px target beside a name is the kind
 * of thing that only works with a mouse. A friend you have never finished a
 * game against has nothing to expand, so their row is inert.
 */
function FriendRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: FriendEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const total = played(entry);
  const rate = winRatePct(entry);
  return (
    <div className="leaderboard-friend">
      <button
        type="button"
        className={clsx("leaderboard-row", "leaderboard-row-friend", expanded && "leaderboard-row-friend-open")}
        onClick={onToggle}
        disabled={entry.games.length === 0}
        aria-expanded={entry.games.length === 0 ? undefined : expanded}
      >
        <Avatar displayName={entry.displayName} accent={entry.accent} />
        <span className="leaderboard-name">{entry.displayName}</span>
        {total === 0 ? (
          <span className="leaderboard-friend-none">No games yet</span>
        ) : (
          <>
            <span className="leaderboard-stat">{formatRecord(entry.wins, entry.losses, entry.draws)}</span>
            <span className={clsx("leaderboard-stat", rate >= 50 ? "leaderboard-profit-up" : "leaderboard-profit-down")}>
              {rate}%
            </span>
            {/* Blank rather than a dash when several games are in play: the
                overall streak is only reported when one game accounts for
                every result, since ordering across games isn't recoverable
                from per-game counters. The per-game rows below carry it. */}
            <span className={clsx("leaderboard-stat", entry.currentStreak < 0 && "leaderboard-profit-down")}>
              {entry.games.length === 1 ? formatStreak(entry.currentStreak) : ""}
            </span>
          </>
        )}
        {entry.games.length > 0 && (
          <ChevronDown size={14} className={clsx("leaderboard-friend-chevron", expanded && "leaderboard-friend-chevron-open")} />
        )}
      </button>
      {expanded && (
        <div className="leaderboard-friend-games">
          {entry.games.map((game) => (
            <div key={game.gameId} className="leaderboard-friend-game">
              <span className="leaderboard-friend-game-label">{game.label}</span>
              <span className="leaderboard-stat">{formatRecord(game.wins, game.losses, game.draws)}</span>
              <span className={clsx("leaderboard-stat", game.currentStreak < 0 && "leaderboard-profit-down")}>
                {formatStreak(game.currentStreak)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
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
 * Renders whatever columns a game's contract named. This, plus the API
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
 * Public rankings. Entertainment-only, same as the Gold it's built from:
 * this is the social-proof loop, not a money one.
 *
 * `embedded` is for the phone lobby's third pane
 * (components/lobby/mobile-shell.tsx), which renders this component rather than
 * a second copy of it. It swaps the page `<main>` for a div (PokerApp already
 * owns the page's), demotes the h1 to an h2 (the pane is not the document's
 * top-level heading), and drops the "← Back to the table" link, which would
 * navigate out of the shell the player is standing in. Defaults to the route's
 * behaviour, so `app/leaderboard/page.tsx` is unchanged.
 */
export function Leaderboard({ embedded = false }: { embedded?: boolean } = {}) {
  const [game, setGame] = useState<Game>("poker");
  const [scope, setScope] = useState<Scope>("season");
  const [pokerEntries, setPokerEntries] = useState<PokerEntry[]>([]);
  const [pokerMine, setPokerMine] = useState<PokerEntry | null>(null);
  const [season, setSeason] = useState<SeasonInfo | null>(null);
  const [genericColumns, setGenericColumns] = useState<LeaderboardColumn[]>([]);
  const [genericLabel, setGenericLabel] = useState<string>("");
  const [genericEntries, setGenericEntries] = useState<GenericEntry[]>([]);
  const [genericMine, setGenericMine] = useState<GenericEntry | null>(null);
  const [genericMineProgress, setGenericMineProgress] = useState<QualifyProgress | null>(null);
  const [globalEntries, setGlobalEntries] = useState<GlobalEntry[]>([]);
  const [globalMine, setGlobalMine] = useState<GlobalEntry | null>(null);
  const [friendEntries, setFriendEntries] = useState<FriendEntry[]>([]);
  const [friendsRequireAccount, setFriendsRequireAccount] = useState(false);
  const [expandedFriend, setExpandedFriend] = useState<string | null>(null);
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
      } else if (nextGame === "friends") {
        setFriendEntries(data.entries);
        setFriendsRequireAccount(Boolean(data.requiresAccount));
      } else {
        setGenericColumns(data.columns ?? []);
        setGenericLabel(data.label ?? "");
        setGenericEntries(data.entries);
        setGenericMine(data.mine);
        setGenericMineProgress(data.mineProgress ?? null);
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

  // Counted per board rather than off one shared `entries` array: the
  // Friends tab's rows are a different shape (your record against them, no
  // rank and no `mine`), and merging the two only to split them again in
  // every branch below buys nothing.
  const rankedEntries = game === "poker" ? pokerEntries : game === "global" ? globalEntries : genericEntries;
  const mineId = game === "poker" ? pokerMine?.profileId : game === "global" ? globalMine?.profileId : genericMine?.profileId;
  const mineIsRanked = mineId !== undefined && rankedEntries.some((entry) => entry.profileId === mineId);
  const entryCount = game === "friends" ? friendEntries.length : rankedEntries.length;
  const empty = !loading && !error && entryCount === 0;

  const Shell = embedded ? "div" : "main";
  const Heading = embedded ? "h2" : "h1";

  return (
    <Shell className={embedded ? "leaderboard-shell leaderboard-shell-embedded" : "leaderboard-shell"}>
      <header className="leaderboard-header">
        <div>
          <div className="lobby-kicker">Standings</div>
          <Heading>The leaderboard.</Heading>
          {/* Em dash here, not the double-hyphen comment idiom: this is
              rendered prose, and a literal double hyphen would print as
              a double hyphen. */}
          <p>
            {game === "poker"
              ? (scope === "lifetime"
                ? "All time, ranked by total Gold won — never nets out a loss."
                : "This season, ranked by net Gold won. Resets every 30 days.")
              : game === "global"
                ? "One rank across every game, blended from where you stand in each."
                : game === "friends"
                  ? "Your record against each friend, across every game the two of you can play head to head."
                  : `${genericLabel || "This game"}'s own board.`}{" "}
            Entertainment only &mdash; nothing here can be cashed out.
          </p>
        </div>
        {!embedded && <Link className="leaderboard-back" href="/">← Back to the table</Link>}
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
          <div className="leaderboard-scope-track">
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
          </div>
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
            : game === "friends"
              ? (friendsRequireAccount
                ? "Sign in to keep a record against your friends."
                : "No friends yet. Add someone from the players menu, then beat them at something.")
              : genericMineProgress
                ? qualifyHint(genericMineProgress)
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

      {game === "friends" && friendEntries.length > 0 && (
        <div className="leaderboard-table">
          <div className={clsx("leaderboard-row", "leaderboard-row-head", "leaderboard-row-friend")}>
            <span />
            <span>Friend</span>
            <span>W-L</span>
            <span>Win %</span>
            <span>Streak</span>
            <span />
          </div>
          {friendEntries.map((entry) => (
            <FriendRow
              key={entry.profileId}
              entry={entry}
              expanded={expandedFriend === entry.profileId}
              onToggle={() => {
                selectSound();
                setExpandedFriend((current) => (current === entry.profileId ? null : entry.profileId));
              }}
            />
          ))}
        </div>
      )}

      {game !== "poker" && game !== "global" && game !== "friends" && genericEntries.length > 0 && (
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

      {game !== "poker" && game !== "global" && game !== "friends" && genericEntries.length > 0 && !genericMine && genericMineProgress && (
        <p className="leaderboard-empty leaderboard-qualify-hint">
          <Coins size={15} />{" "}{qualifyHint(genericMineProgress)}
        </p>
      )}
    </Shell>
  );
}
