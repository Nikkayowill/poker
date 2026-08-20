import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetHeadToHeadMemory,
  getHeadToHeadRecords,
  getHeadToHeadSummaries,
  recordHeadToHeadDuel,
  recordHeadToHeadTable,
} from "./head-to-head-store";
import { ensureProfile } from "./profile-store";

async function newPlayer(name: string) {
  const profile = await ensureProfile(randomUUID(), name);
  return profile.id;
}

beforeEach(() => {
  __resetHeadToHeadMemory();
});

describe("recordHeadToHeadDuel", () => {
  it("writes both sides of one result, so each player reads their own view of it", async () => {
    const [a, b] = [await newPlayer("A"), await newPlayer("B")];
    await recordHeadToHeadDuel("chess", [a, b], 0);

    expect((await getHeadToHeadRecords(a, [b])).get(b)).toMatchObject({ wins: 1, losses: 0, draws: 0 });
    expect((await getHeadToHeadRecords(b, [a])).get(a)).toMatchObject({ wins: 0, losses: 1, draws: 0 });
  });

  it("keeps the mirror exact over a run of results from both seats", async () => {
    const [a, b] = [await newPlayer("A"), await newPlayer("B")];
    await recordHeadToHeadDuel("chess", [a, b], 0); // a wins
    await recordHeadToHeadDuel("chess", [b, a], 0); // b wins (seats swapped)
    await recordHeadToHeadDuel("chess", [a, b], null); // draw

    const mine = (await getHeadToHeadRecords(a, [b])).get(b)!;
    const theirs = (await getHeadToHeadRecords(b, [a])).get(a)!;
    expect(mine.wins).toBe(theirs.losses);
    expect(mine.losses).toBe(theirs.wins);
    expect(mine.draws).toBe(theirs.draws);
  });

  it("counts a losing streak down and a draw back to zero", async () => {
    const [a, b] = [await newPlayer("A"), await newPlayer("B")];
    // The case this whole board exists for: five straight losses to one person.
    for (let i = 0; i < 5; i += 1) await recordHeadToHeadDuel("chess", [a, b], 1);

    expect((await getHeadToHeadRecords(a, [b])).get(b)).toEqual({
      wins: 0, losses: 5, draws: 0, currentStreak: -5, bestStreak: 0,
    });
    expect((await getHeadToHeadRecords(b, [a])).get(a)).toEqual({
      wins: 5, losses: 0, draws: 0, currentStreak: 5, bestStreak: 5,
    });

    await recordHeadToHeadDuel("chess", [a, b], null);
    const afterDraw = (await getHeadToHeadRecords(b, [a])).get(a)!;
    expect(afterDraw.currentStreak).toBe(0);
    // A draw ends the run without erasing that it happened.
    expect(afterDraw.bestStreak).toBe(5);
  });

  it("ignores a game that has no opponent to hold a record against", async () => {
    const [a, b] = [await newPlayer("A"), await newPlayer("B")];
    // Memory Match is an average-metric game; poker is never head-to-head at
    // all. Neither may open a record.
    await recordHeadToHeadDuel("memory-match", [a, b], 0);
    await recordHeadToHeadDuel("poker", [a, b], 0);
    expect((await getHeadToHeadRecords(a, [b])).size).toBe(0);
  });
});

describe("recordHeadToHeadTable", () => {
  it("gives the winner a win over every other seat", async () => {
    const [a, b, c] = [await newPlayer("A"), await newPlayer("B"), await newPlayer("C")];
    await recordHeadToHeadTable("cribbage", [a, b, c], a);

    const winner = await getHeadToHeadRecords(a, [b, c]);
    expect(winner.get(b)).toMatchObject({ wins: 1, losses: 0 });
    expect(winner.get(c)).toMatchObject({ wins: 1, losses: 0 });
    expect((await getHeadToHeadRecords(b, [a])).get(a)).toMatchObject({ wins: 0, losses: 1 });
  });

  it("records nothing between two players who both lost", async () => {
    const [a, b, c] = [await newPlayer("A"), await newPlayer("B"), await newPlayer("C")];
    await recordHeadToHeadTable("cribbage", [a, b, c], a);

    // Neither beat the other. Recording a loss on both sides would leave B
    // holding a loss to C while C holds one to B, which is the one thing the
    // mirrored rows must never say.
    expect((await getHeadToHeadRecords(b, [c])).get(c)).toBeUndefined();
    expect((await getHeadToHeadRecords(c, [b])).get(b)).toBeUndefined();
  });
});

describe("getHeadToHeadSummaries", () => {
  it("totals across games and splits them out, most played first", async () => {
    const [a, b] = [await newPlayer("A"), await newPlayer("B")];
    await recordHeadToHeadDuel("chess", [a, b], 0);
    await recordHeadToHeadDuel("chess", [a, b], 1);
    await recordHeadToHeadDuel("chess", [a, b], 1);
    await recordHeadToHeadTable("cribbage", [b, a], b);

    const summary = (await getHeadToHeadSummaries(a, [b])).get(b)!;
    expect(summary).toMatchObject({ opponentId: b, wins: 1, losses: 3, draws: 0 });
    expect(summary.games.map((game) => game.gameId)).toEqual(["chess", "cribbage"]);
    expect(summary.games[0]).toMatchObject({ label: "Chess", wins: 1, losses: 2, currentStreak: -2 });
  });

  it("reports an overall streak only when one game accounts for every result", async () => {
    const [a, b] = [await newPlayer("A"), await newPlayer("B")];
    await recordHeadToHeadDuel("chess", [a, b], 1);
    await recordHeadToHeadDuel("chess", [a, b], 1);
    expect((await getHeadToHeadSummaries(a, [b])).get(b)!.currentStreak).toBe(-2);

    // A second game means the results interleave in an order these counters
    // can't recover, so the honest overall answer is none.
    await recordHeadToHeadDuel("checkers", [a, b], 1);
    expect((await getHeadToHeadSummaries(a, [b])).get(b)!.currentStreak).toBe(0);
  });

  it("leaves out an opponent you have never finished a game against", async () => {
    const [a, b, stranger] = [await newPlayer("A"), await newPlayer("B"), await newPlayer("S")];
    await recordHeadToHeadDuel("chess", [a, b], 0);

    const summaries = await getHeadToHeadSummaries(a, [b, stranger]);
    expect(summaries.has(b)).toBe(true);
    expect(summaries.has(stranger)).toBe(false);
  });

  it("asks for nothing when there is nobody to ask about", async () => {
    const a = await newPlayer("A");
    expect((await getHeadToHeadSummaries(a, [])).size).toBe(0);
  });
});
