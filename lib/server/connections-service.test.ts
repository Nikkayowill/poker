import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { pickDaily, puzzleDay } from "@/lib/arcade/puzzles/daily";
import { CONNECTIONS_PUZZLES } from "@/lib/arcade/puzzles/connections-puzzles";
import type { ConnectionsLevel } from "@/lib/arcade/puzzles/connections";
import { __resetDailyPuzzlesForTest } from "./daily-puzzle-store";
import {
  CONNECTIONS_GAME,
  ConnectionsRequestError,
  playConnectionsGuess,
  readConnectionsPuzzle,
  startConnectionsPuzzle,
} from "./connections-service";
import { ensureProfile } from "./profile-store";

/**
 * The contract, in memory mode.
 *
 * The day's puzzle is derived with the same public function the service uses
 * rather than injected, for the reason the Wordle tests do it: a seam to
 * override the daily selection is a seam an attacker would want. It also means
 * these tests fail loudly if the selection ever stops being deterministic.
 */

function today(): string {
  return puzzleDay(new Date());
}

/** The four words of one group of today's board. */
function group(level: ConnectionsLevel): string[] {
  const puzzle = pickDaily(CONNECTIONS_PUZZLES, today(), CONNECTIONS_GAME);
  return puzzle.groups.find((entry) => entry.level === level)!.members;
}

/** A selection guaranteed to be wrong: one word from each group. */
function scattered(): string[] {
  return ([0, 1, 2, 3] as ConnectionsLevel[]).map((level) => group(level)[0]);
}

/** Three from one group plus a stray -- the "one away" shape. */
function nearly(level: ConnectionsLevel): string[] {
  const other = level === 0 ? 1 : 0;
  return [...group(level).slice(0, 3), group(other as ConnectionsLevel)[3]];
}

async function player() {
  const token = randomUUID();
  await ensureProfile(token);
  return token;
}

/** Plays a sequence of selections, threading the version. Returns the last view. */
async function playAll(token: string, selections: string[][], startVersion = 1) {
  let version = startVersion;
  let view = await readConnectionsPuzzle(token);
  for (const selection of selections) {
    view = await playConnectionsGuess(token, { day: today(), version, selection });
    version += 1;
  }
  return view;
}

beforeEach(() => {
  __resetDailyPuzzlesForTest();
});

describe("readConnectionsPuzzle", () => {
  it("reports no board before one is opened, and does not open one", async () => {
    const token = await player();
    expect((await readConnectionsPuzzle(token)).round).toBeNull();
    expect((await readConnectionsPuzzle(token)).round).toBeNull();
  });
});

describe("startConnectionsPuzzle", () => {
  it("opens a board of sixteen words", async () => {
    const view = await startConnectionsPuzzle(await player());
    expect(view.resumed).toBe(false);
    expect(view.round?.words).toHaveLength(16);
    expect(view.round?.mistakes).toBe(0);
  });

  it("never sends an unsolved group's label or grouping", async () => {
    // The words themselves are on the board, so the leak to guard is the
    // *assignment* -- the labels and the per-word colours.
    const view = await startConnectionsPuzzle(await player());
    const wire = JSON.stringify(view);
    const puzzle = pickDaily(CONNECTIONS_PUZZLES, today(), CONNECTIONS_GAME);
    puzzle.groups.forEach((entry) => expect(wire).not.toContain(entry.label));
    expect(view.round?.revealed).toEqual([]);
    expect(view.round?.guessRows).toBeNull();
  });

  it("shuffles the board, so tiles do not arrive grouped", async () => {
    const view = await startConnectionsPuzzle(await player());
    const puzzle = pickDaily(CONNECTIONS_PUZZLES, today(), CONNECTIONS_GAME);
    const authored = puzzle.groups.flatMap((entry) => entry.members);
    // Sixteen tiles have a 1-in-16! chance of shuffling back to authored
    // order, which is not a flake worth engineering around.
    expect(view.round?.words).not.toEqual(authored);
    expect([...(view.round?.words ?? [])].sort()).toEqual([...authored].sort());
  });

  it("resumes rather than re-dealing, finished or not", async () => {
    const token = await player();
    await startConnectionsPuzzle(token);
    await playConnectionsGuess(token, { day: today(), version: 1, selection: group(0) });

    const again = await startConnectionsPuzzle(token);
    expect(again.resumed).toBe(true);
    expect(again.round?.revealed).toHaveLength(1);
  });
});

describe("playConnectionsGuess", () => {
  it("solves a group and names it", async () => {
    const token = await player();
    await startConnectionsPuzzle(token);
    const view = await playConnectionsGuess(token, { day: today(), version: 1, selection: group(0) });

    expect(view.round?.lastVerdict).toBe("correct");
    expect(view.round?.revealed).toHaveLength(1);
    expect(view.round?.revealed[0].solved).toBe(true);
    expect(view.round?.words).toHaveLength(12);
    expect(view.round?.mistakes).toBe(0);
  });

  it("says one away without saying which word is wrong", async () => {
    const token = await player();
    await startConnectionsPuzzle(token);
    const view = await playConnectionsGuess(token, { day: today(), version: 1, selection: nearly(0) });

    expect(view.round?.lastVerdict).toBe("one-away");
    expect(view.round?.mistakes).toBe(1);
    // Still no per-word colours: four wrong guesses that each reported them
    // would be a free complete solution.
    expect(view.round?.guessRows).toBeNull();
    expect(view.round?.revealed).toEqual([]);
  });

  it("charges a mistake for a scattered guess", async () => {
    const token = await player();
    await startConnectionsPuzzle(token);
    const view = await playConnectionsGuess(token, { day: today(), version: 1, selection: scattered() });
    expect(view.round?.lastVerdict).toBe("wrong");
    expect(view.round?.mistakes).toBe(1);
  });

  it("releases the colour matrix only once the board is won", async () => {
    const token = await player();
    await startConnectionsPuzzle(token);
    const view = await playAll(token, [group(0), group(1), group(2), group(3)]);

    expect(view.round?.status).toBe("won");
    expect(view.round?.guessRows).toEqual([[0, 0, 0, 0], [1, 1, 1, 1], [2, 2, 2, 2], [3, 3, 3, 3]]);
    expect(view.round?.revealed).toHaveLength(4);
  });

  it("reveals every group once the player has lost", async () => {
    const token = await player();
    await startConnectionsPuzzle(token);
    // Four distinct scattered selections: rotating which group each word comes
    // from keeps them wrong and keeps them from being refused as repeats.
    const wrong = ([0, 1, 2, 3] as ConnectionsLevel[]).map((offset) =>
      ([0, 1, 2, 3] as ConnectionsLevel[]).map((level) => group(level)[offset]),
    );
    const view = await playAll(token, wrong);

    expect(view.round?.status).toBe("lost");
    expect(view.round?.mistakes).toBe(4);
    expect(view.round?.revealed).toHaveLength(4);
    expect(view.round?.revealed.every((entry) => !entry.solved)).toBe(true);
    expect(view.round?.guessRows).toHaveLength(4);
  });

  it("refuses a repeated selection without charging a mistake", async () => {
    const token = await player();
    await startConnectionsPuzzle(token);
    await playConnectionsGuess(token, { day: today(), version: 1, selection: scattered() });

    await expect(
      playConnectionsGuess(token, { day: today(), version: 2, selection: scattered() }),
    ).rejects.toMatchObject({ status: 400, reason: "repeat" });

    expect((await readConnectionsPuzzle(token)).round?.mistakes).toBe(1);
  });

  it("refuses a word that is not on the board", async () => {
    const token = await player();
    await startConnectionsPuzzle(token);
    await expect(
      playConnectionsGuess(token, {
        day: today(),
        version: 1,
        selection: [...group(0).slice(0, 3), "WOMBATTERY"],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a stale version, so a double-fired submit costs one mistake not two", async () => {
    const token = await player();
    await startConnectionsPuzzle(token);

    const results = await Promise.allSettled([
      playConnectionsGuess(token, { day: today(), version: 1, selection: scattered() }),
      playConnectionsGuess(token, { day: today(), version: 1, selection: nearly(0) }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await readConnectionsPuzzle(token)).round?.mistakes).toBe(1);
  });

  it("refuses a guess aimed at a board that has rolled over", async () => {
    const token = await player();
    await startConnectionsPuzzle(token);
    await expect(
      playConnectionsGuess(token, { day: "2020-01-01", version: 1, selection: group(0) }),
    ).rejects.toMatchObject({ status: 409, reason: "rolled-over" });
  });

  it("carries the true board back on a rejection", async () => {
    const token = await player();
    await startConnectionsPuzzle(token);
    await playConnectionsGuess(token, { day: today(), version: 1, selection: group(0) });

    const error = await playConnectionsGuess(token, {
      day: today(),
      version: 1,
      selection: group(1),
    }).catch((thrown) => thrown as ConnectionsRequestError);

    expect(error).toBeInstanceOf(ConnectionsRequestError);
    expect((error as ConnectionsRequestError).round?.revealed).toHaveLength(1);
  });

  it("refuses a guess before the board is opened", async () => {
    await expect(
      playConnectionsGuess(await player(), { day: today(), version: 1, selection: group(0) }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
