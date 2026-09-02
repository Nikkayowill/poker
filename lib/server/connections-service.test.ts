import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUZZLE_EPOCH_DAY, pickDaily, previousDay, puzzleDay } from "@/lib/arcade/puzzles/daily";
import { CONNECTIONS_PUZZLES } from "@/lib/arcade/puzzles/connections-puzzles";
import type { ConnectionsLevel } from "@/lib/arcade/puzzles/connections";
import { __resetDailyPuzzlesForTest, createPuzzleRound, getPuzzleRound } from "./daily-puzzle-store";
import {
  CONNECTIONS_GAME,
  ConnectionsRequestError,
  listConnectionsArchive,
  playConnectionsGuess,
  readConnectionsPuzzle,
  startConnectionsPuzzle,
  type StoredConnectionsRound,
} from "./connections-service";
import { adjustGold, ensureProfile } from "./profile-store";

/**
 * A switch for making the canonical-answer lookup fail, for the ordering test
 * at the bottom of this file. Everything else in daily-puzzle-store is the
 * real thing -- this only stands in for the one call, and only when asked.
 */
const canon = vi.hoisted(() => ({ fails: false }));

vi.mock("./daily-puzzle-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./daily-puzzle-store")>();
  return {
    ...actual,
    getOrCreateCanonicalAnswer: (...args: Parameters<typeof actual.getOrCreateCanonicalAnswer>) =>
      canon.fails
        ? Promise.reject(new Error("canon unavailable"))
        : actual.getOrCreateCanonicalAnswer(...args),
  };
});

/**
 * The contract, in memory mode.
 *
 * The day's puzzle is derived with the same public function the service uses
 * rather than injected, for the reason the Word Stack tests do it: a seam to
 * override the daily selection is a seam an attacker would want. It also means
 * these tests fail loudly if the selection ever stops being deterministic.
 */

function today(): string {
  return puzzleDay(new Date());
}

function tomorrow(): string {
  return puzzleDay(new Date(Date.now() + 24 * 60 * 60 * 1000));
}

/** The four words of one group of a given day's board. */
function groupFor(day: string, level: ConnectionsLevel): string[] {
  const puzzle = pickDaily(CONNECTIONS_PUZZLES, day, CONNECTIONS_GAME);
  return puzzle.groups.find((entry) => entry.level === level)!.members;
}

/** The four words of one group of today's board. */
function group(level: ConnectionsLevel): string[] {
  return groupFor(today(), level);
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
async function playAll(token: string, selections: string[][], startVersion = 1, day = today()) {
  let version = startVersion;
  let view = await readConnectionsPuzzle(token, day);
  for (const selection of selections) {
    view = await playConnectionsGuess(token, { day, version, selection });
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
      playConnectionsGuess(token, { day: tomorrow(), version: 1, selection: group(0) }),
    ).rejects.toMatchObject({ status: 409, reason: "rolled-over" });
  });

  it("refuses a guess dated before the archive begins", async () => {
    const token = await player();
    await startConnectionsPuzzle(token);
    await expect(
      playConnectionsGuess(token, { day: previousDay(PUZZLE_EPOCH_DAY), version: 1, selection: group(0) }),
    ).rejects.toMatchObject({ status: 400 });
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

describe("the puzzle archive", () => {
  it("opens and plays a past day end to end, free, with that day's own puzzle number", async () => {
    const token = await player();
    const day = previousDay(today());

    const opened = await startConnectionsPuzzle(token, 0, day);
    expect(opened.day).toBe(day);
    expect(opened.round?.wager).toBe(0);

    const won = await playAll(
      token,
      ([0, 1, 2, 3] as ConnectionsLevel[]).map((level) => groupFor(day, level)),
      1,
      day,
    );
    expect(won.round?.status).toBe("won");
    expect(won.day).toBe(day);
  });

  it("refuses a wager on an archive day, and never touches the wallet", async () => {
    const token = await player();
    const before = (await ensureProfile(token)).goldBalance;
    const day = previousDay(today());
    await expect(startConnectionsPuzzle(token, 1000, day)).rejects.toMatchObject({ status: 400 });
    expect((await ensureProfile(token)).goldBalance).toBe(before);
  });

  it("rejects opening a day after today", async () => {
    await expect(startConnectionsPuzzle(await player(), 0, tomorrow())).rejects.toMatchObject({ status: 400 });
  });

  it("rejects opening a day before the archive begins", async () => {
    await expect(
      startConnectionsPuzzle(await player(), 0, previousDay(PUZZLE_EPOCH_DAY)),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("gives no daily bonus for completing an archive day, only for completing today's puzzle", async () => {
    const archiveToken = await player();
    const day = previousDay(today());
    await startConnectionsPuzzle(archiveToken, 0, day);
    const beforeArchive = (await ensureProfile(archiveToken)).goldBalance;
    await playAll(
      archiveToken,
      ([0, 1, 2, 3] as ConnectionsLevel[]).map((level) => groupFor(day, level)),
      1,
      day,
    );
    expect((await ensureProfile(archiveToken)).goldBalance).toBe(beforeArchive);

    const todayToken = await player();
    await startConnectionsPuzzle(todayToken, 0);
    const beforeToday = (await ensureProfile(todayToken)).goldBalance;
    await playAll(todayToken, ([0, 1, 2, 3] as ConnectionsLevel[]).map((level) => group(level)));
    expect((await ensureProfile(todayToken)).goldBalance).toBeGreaterThan(beforeToday);
  });

  it("gives a later archive opener the same puzzle a prior real attempt already recorded", async () => {
    // The regression this guards: pickDaily is a pure function of the pool's
    // *current* size, so recomputing it fresh for an old day would silently
    // disagree with whatever the first real player actually saw if the pool
    // has changed size since. A planted mismatch stands in for that drift.
    const day = previousDay(today());
    const truePuzzle = pickDaily(CONNECTIONS_PUZZLES, day, CONNECTIONS_GAME);
    const plantedGroups = truePuzzle.groups.map((group, index) => ({
      ...group,
      label: `PLANTED ${index}`,
    }));

    const priorToken = await player();
    const priorProfile = await ensureProfile(priorToken);
    await createPuzzleRound<StoredConnectionsRound>({
      profileId: priorProfile.id,
      game: CONNECTIONS_GAME,
      day,
      round: {
        groups: plantedGroups,
        order: plantedGroups.flatMap((g) => g.members),
        solvedLevels: [],
        attempts: [],
        mistakes: 0,
        status: "active",
        lastVerdict: null,
        wager: 0,
      },
      complete: false,
    });

    const laterToken = await player();
    await startConnectionsPuzzle(laterToken, 0, day);
    const laterProfile = await ensureProfile(laterToken);
    const stored = await getPuzzleRound<StoredConnectionsRound>(laterProfile.id, CONNECTIONS_GAME, day);
    expect(stored?.round.groups.map((g) => g.label)).toEqual(plantedGroups.map((g) => g.label));
  });

  it("lists every day since the epoch, newest first, with this player's own status", async () => {
    const token = await player();
    const yesterday = previousDay(today());
    await startConnectionsPuzzle(token, 0, yesterday);
    await playAll(
      token,
      ([0, 1, 2, 3] as ConnectionsLevel[]).map((level) => groupFor(yesterday, level)),
      1,
      yesterday,
    );

    const archive = await listConnectionsArchive(token);
    expect(archive[0].day).toBe(yesterday);
    expect(archive[0].status).toBe("won");
    expect(archive.every((entry) => entry.day < today())).toBe(true);
    expect(archive.every((entry) => entry.day >= PUZZLE_EPOCH_DAY)).toBe(true);
    expect(archive.some((entry) => entry.status === "not-started")).toBe(true);
  });

  it("answers a null token (no session cookie yet) without minting a profile", async () => {
    // Same regression word-stack-service.test.ts guards: a GET-only route
    // must never create a session, and a visitor with no cookie has by
    // definition played nothing.
    const archive = await listConnectionsArchive(null);
    expect(archive.length).toBeGreaterThan(0);
    expect(archive.every((entry) => entry.status === "not-started")).toBe(true);
  });
});

/**
 * The stake must not leave before everything that can throw has thrown.
 *
 * Same bug and same fix as word-stack-service.ts -- both services shared the
 * ordering. getOrCreateCanonicalAnswer sat between the debit and the
 * try/catch that refunds a failed round creation, so a throw from it charged
 * the player and handed back no board. Not hypothetical: daily_puzzle_canon's
 * migration went unapplied while its calling code was live, so the call threw
 * on every wagered open until the table was created on 2026-09-01.
 */
describe("a failed canon lookup does not take the stake", () => {
  async function fundedPlayer(gold: number) {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    const delta = gold - profile.goldBalance;
    if (delta !== 0) await adjustGold(profile.id, delta);
    return { token, id: profile.id };
  }

  it("leaves the balance untouched when the canonical puzzle cannot be read", async () => {
    const { token, id } = await fundedPlayer(50_000);
    const before = (await ensureProfile(token)).goldBalance;

    canon.fails = true;
    try {
      await expect(startConnectionsPuzzle(token, 1000)).rejects.toThrow("canon unavailable");
    } finally {
      canon.fails = false;
    }

    expect((await ensureProfile(token)).goldBalance).toBe(before);
    // And no half-open round was left behind to burn the day's attempt.
    expect(await getPuzzleRound<StoredConnectionsRound>(id, CONNECTIONS_GAME, today())).toBeNull();
  });
});
