import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { MEMORY_TILES } from "@/lib/arcade/puzzles/memory";
import { __resetLeaderboardMemory, getGameStanding } from "./leaderboard-store";
import { flipMemory, startMemory } from "./memory-service";
import { ensureProfile } from "./profile-store";

/**
 * The one thing this file exists to check: a solved Memory Match round
 * records its exact turn count into the leaderboard store (the metric this
 * game ranks by is turns-to-clear, lower being better -- see this file's own
 * header on why the layout itself never leaves the service). Everything else
 * about scoring/turn-counting is covered by lib/arcade/puzzles/memory.test.ts
 * at the pure-engine level; this is the one new line at the service's
 * completion call site.
 */

beforeEach(() => {
  __resetLeaderboardMemory();
});

/**
 * Solves a real board through the real service, with no foreknowledge of the
 * shuffle: it learns each card's rank as flips reveal it (the response really
 * does show a revealed tile's card -- see memory.ts's own header on why that
 * is fine, and why the layout itself still never crosses a snapshot for a
 * face-down tile). Once two known indices share a rank, it flips exactly
 * that pair; otherwise it flips the lowest unseen index to learn more.
 * Capped, not `while (true)`, matching this codebase's other real-engine
 * playthrough tests -- a rules bug that never terminates should fail this
 * test, not hang the suite.
 */
async function solveOneRound(token: string, now: Date) {
  let view = await startMemory(token, now);
  const known = new Map<number, string>();
  const learn = () => {
    for (let index = 0; index < MEMORY_TILES; index += 1) {
      const card = view.round!.board[index];
      if (card) known.set(index, card.rank);
    }
  };
  learn();

  for (let guard = 0; guard < 60 && view.round!.status !== "solved"; guard += 1) {
    const matchedSet = new Set(view.round!.matched);
    let pair: [number, number] | null = null;
    outer: for (const [i, rank] of known) {
      if (matchedSet.has(i)) continue;
      for (const [j, otherRank] of known) {
        if (j === i || matchedSet.has(j)) continue;
        if (otherRank === rank) { pair = [i, j]; break outer; }
      }
    }
    const nextUnseen = () =>
      Array.from({ length: MEMORY_TILES }, (_, i) => i).find((i) => !matchedSet.has(i) && !known.has(i))!;

    const first = pair ? pair[0] : nextUnseen();
    view = await flipMemory(token, { version: view.round!.version, index: first }, now);
    learn();
    if (view.round!.status === "solved") break;

    const secondMatched = new Set(view.round!.matched);
    const second = pair
      ? pair[1]
      : (() => {
        const firstRank = known.get(first)!;
        for (const [i, rank] of known) {
          if (i !== first && !secondMatched.has(i) && rank === firstRank) return i;
        }
        return Array.from({ length: MEMORY_TILES }, (_, i) => i)
          .find((i) => i !== first && !secondMatched.has(i) && !known.has(i))!;
      })();
    view = await flipMemory(token, { version: view.round!.version, index: second }, now);
    learn();
  }

  if (view.round!.status !== "solved") throw new Error("Memory board did not solve within the guard.");
  return view.round!.turns;
}

describe("flipMemory's leaderboard hook", () => {
  it("records the exact turn count of every completed round, one attempt per day", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    const days = [
      new Date("2026-08-10T12:00:00.000Z"),
      new Date("2026-08-11T12:00:00.000Z"),
      new Date("2026-08-12T12:00:00.000Z"),
    ];

    let totalTurns = 0;
    for (const day of days) {
      totalTurns += await solveOneRound(token, day);
    }

    // Below minSample (3) after one or two rounds; the third clears it, and
    // the recorded sum must equal exactly what those rounds actually took --
    // not MEMORY_PAIRS, not a hardcoded number, since the shuffle is real.
    const standing = await getGameStanding("memory-match", profile.id);
    expect(standing).not.toBeNull();
    expect(standing!.stats.metricCount).toBe(3);
    expect(standing!.stats.metricSum).toBe(totalTurns);
  });
});
