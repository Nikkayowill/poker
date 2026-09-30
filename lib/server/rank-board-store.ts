import "server-only";
import { levelForXp, rankTitle } from "@/lib/progression/rank";
import { rankPointsFrom, summarizeSoloEarnings } from "@/lib/progression/solo-earnings";
import { listFriendIds } from "./friends-store";
import { decorateRankedRows, type RankedIdentity } from "./leaderboard-identity";
import { listSoloStates, type SoloState } from "./solo-earnings-store";

/**
 * The rank boards: everyone ordered by rank points, the same number the lobby
 * strip shows. Read-only. Rank points are derived here from the base and the
 * band totals, so retuning a band weight in lib/progression/solo-earnings.ts
 * reorders the boards with no data change.
 */

export type RankBoardEntry = RankedIdentity & {
  points: number;
  level: number;
  title: string;
  /** Label of the stake band the player's earnings centre on, or null with nothing earned yet. */
  difficulty: string | null;
};

interface Scored {
  profileId: string;
  points: number;
  state: SoloState;
}

function score(profileId: string, state: SoloState): Scored {
  return { profileId, points: rankPointsFrom(state.base, state.byBand), state };
}

/** Points high to low; equal points fall back to the profile id so the order never shuffles between reads. */
function byPoints(a: Scored, b: Scored): number {
  return b.points - a.points || (a.profileId < b.profileId ? -1 : a.profileId > b.profileId ? 1 : 0);
}

async function decorate(rows: Scored[]): Promise<RankBoardEntry[]> {
  return decorateRankedRows(rows, (row) => {
    const level = levelForXp(row.points);
    return {
      points: row.points,
      level,
      title: rankTitle(level),
      difficulty: summarizeSoloEarnings(row.state.byBand).difficulty.label,
    };
  });
}

/**
 * The top of the global board, plus the viewer's own row when they are outside it.
 * `mine` is null for a guest or a player with nothing to rank.
 */
export async function getGlobalRankBoard(
  limit: number,
  viewerId: string | null,
): Promise<{ entries: RankBoardEntry[]; mine: RankBoardEntry | null }> {
  const states = await listSoloStates(null);
  const ranked = [...states].map(([id, state]) => score(id, state)).sort(byPoints);
  const top = ranked.slice(0, limit);
  const entries = await decorate(top);
  if (!viewerId || entries.some((entry) => entry.profileId === viewerId)) return { entries, mine: null };

  const position = ranked.findIndex((row) => row.profileId === viewerId);
  if (position === -1) return { entries, mine: null };
  const [mineRow] = await decorate([ranked[position]]);
  return { entries, mine: { ...mineRow, rank: position + 1 } };
}

/** The viewer and their friends, ranked among themselves. Friends with no play still appear. */
export async function getFriendsRankBoard(viewerId: string): Promise<RankBoardEntry[]> {
  const ids = [...new Set([viewerId, ...(await listFriendIds(viewerId))])];
  const states = await listSoloStates(ids);
  const ranked = ids.map((id) => score(id, states.get(id) ?? { base: 0, byBand: {} })).sort(byPoints);
  return decorate(ranked);
}
