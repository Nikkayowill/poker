"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import { Coins, Crown } from "lucide-react";
import { selectSound } from "@/lib/audio/ui-sounds";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { RankJewel } from "@/components/profile/rank-jewel";
import type { RankTierId } from "@/lib/progression/rank";
import type { AvatarPreset } from "@/lib/profile/types";
import { Skeleton } from "@/components/loading/skeleton";
import { useMinHoldFade } from "@/components/loading/use-min-hold-fade";

/** The extra identity fields a top-3 row needs to render ProfileAvatar's real portrait instead of the initials disc. Every rank still carries these; only rank <= 3 uses them. */
interface RankedAvatarIdentity {
  initials: string;
  avatarUrl: string | null;
  avatarPreset: AvatarPreset;
  avatarCosmetic: string;
}

/** One row of either board: a player's rank points, with the tier and difficulty they read as. */
interface RankEntry extends RankedAvatarIdentity {
  profileId: string;
  rank: number;
  displayName: string;
  accent: string;
  points: number;
  tierId: RankTierId;
  tierName: string;
  /** The stake band their earnings centre on, or null before they have earned anything. */
  difficulty: string | null;
}

type Board = "global" | "friends";

const TABS: { id: Board; label: string }[] = [
  { id: "global", label: "Global Ranked" },
  { id: "friends", label: "Friends" },
];

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

/**
 * Top 3 get the player's real equipped character portrait, the same art the
 * table draws at their seat -- everyone else keeps the plain initials disc.
 * Structure only: this is still the same row shape/slot as `Avatar`, just a
 * different element filling it.
 */
function RankAvatar({ entry }: { entry: RankedAvatarIdentity & { rank: number; displayName: string; accent: string } }) {
  if (entry.rank > 3) return <Avatar displayName={entry.displayName} accent={entry.accent} />;
  return <ProfileAvatar profile={entry} className="leaderboard-avatar-photo" />;
}

function RankRow({ entry, mine }: { entry: RankEntry; mine: boolean }) {
  return (
    <div className={clsx("leaderboard-row", mine && "leaderboard-row-mine")}>
      <RankBadge rank={entry.rank} />
      <RankAvatar entry={entry} />
      <span className="leaderboard-name-block">
        <span className="leaderboard-name">{entry.displayName}{mine && <em> (you)</em>}</span>
        <span className="leaderboard-sub">
          <RankJewel tier={entry.tierId} size={16} shine={false} className="leaderboard-jewel" />
          {entry.tierName}
          {entry.difficulty && <> &middot; {entry.difficulty}</>}
        </span>
      </span>
      <span className="leaderboard-points">{entry.points.toLocaleString()} RP</span>
    </div>
  );
}

/**
 * Rows shown while a tab's own entries are still loading. Without them nothing
 * rendered at all (neither the table, the empty state, nor an error, since
 * `empty` is defined as `!loading && !error && count === 0`).
 */
function LeaderboardRowsSkeleton({ fading }: { fading: boolean }) {
  return (
    <div className={clsx("leaderboard-table", fading && "leaderboard-table-fading")} aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="leaderboard-row">
          <Skeleton className="skeleton-leaderboard-rank" />
          <Skeleton className="skeleton-leaderboard-avatar" />
          <Skeleton className="skeleton-leaderboard-name" />
          <Skeleton className="skeleton-leaderboard-stat" />
        </div>
      ))}
    </div>
  );
}

/**
 * Public rankings, ordered by rank points from solo wagers. Entertainment
 * only, same as the Gold it's built from.
 *
 * `embedded` is for the phone lobby's leaderboard pane
 * (components/lobby/mobile-shell.tsx), which renders this component rather than
 * a second copy of it. It swaps the page `<main>` for a div (PokerApp already
 * owns the page's), demotes the h1 to an h2 (the pane is not the document's
 * top-level heading), and drops the "← Back to the table" link, which would
 * navigate out of the shell the player is standing in. Defaults to the route's
 * behaviour, so `app/leaderboard/page.tsx` is unchanged.
 */
export function Leaderboard({ embedded = false }: { embedded?: boolean } = {}) {
  const [board, setBoard] = useState<Board>("global");
  const [entries, setEntries] = useState<RankEntry[]>([]);
  const [mine, setMine] = useState<RankEntry | null>(null);
  const [requiresAccount, setRequiresAccount] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Aborted when the tab changes, so an older tab's answer can't land last
  // and fill this one, and can't clear `loading` while this one is still out.
  const load = useCallback(async (next: Board, signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/leaderboard?game=${next}`, { cache: "no-store", signal });
      const data = await response.json();
      if (signal.aborted) return;
      if (!response.ok) throw new Error(data.error ?? "Could not load the leaderboard.");
      setEntries(data.entries);
      setMine(data.mine ?? null);
      setRequiresAccount(Boolean(data.requiresAccount));
    } catch (caught) {
      if (signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "Could not load the leaderboard.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(board, controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load, board]);

  // Switching tabs clears the old rows so a slow response never shows the
  // other board's players under the new tab's name.
  const switchBoard = (next: Board) => {
    if (next === board) return;
    selectSound();
    setEntries([]);
    setMine(null);
    setBoard(next);
  };

  const mineIsRanked = mine !== null && entries.some((entry) => entry.profileId === mine.profileId);
  const empty = !loading && !error && entries.length === 0;

  // The hold keeps a same-tab reload (already cached, resolves almost
  // instantly) from flashing the skeleton for a single frame.
  const rowsPhase = useMinHoldFade(loading && entries.length === 0, { minMs: 300, fadeMs: 200 });

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
            {board === "global"
              ? "Ranked by Rank Points from solo wagers. Harder stakes count for far more."
              : "You and your friends, ranked by Rank Points."}{" "}
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
            className={clsx("leaderboard-game-tab", board === tab.id && "leaderboard-game-tab-active")}
            onClick={() => switchBoard(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <p className="leaderboard-error">{error}</p>}

      {rowsPhase !== "hidden" && <LeaderboardRowsSkeleton fading={rowsPhase === "hiding"} />}

      {empty && (
        <p className="leaderboard-empty">
          <Coins size={15} />{" "}
          {board === "friends"
            ? (requiresAccount
              ? "Sign in to see how you rank against your friends."
              : "No friends yet. Add someone from the players menu.")
            : "Nobody is ranked yet. Win a solo wager to be the first."}
        </p>
      )}

      {entries.length > 0 && (
        <div className="leaderboard-table">
          <div className="leaderboard-row leaderboard-row-head">
            <span>#</span>
            <span />
            <span>Player</span>
            <span style={{ textAlign: "right" }}>Rank Points</span>
          </div>
          {entries.map((entry) => (
            <RankRow key={entry.profileId} entry={entry} mine={entry.profileId === mine?.profileId} />
          ))}
          {mine && !mineIsRanked && (
            <>
              <div className="leaderboard-divider" />
              <RankRow entry={mine} mine />
            </>
          )}
        </div>
      )}
    </Shell>
  );
}
