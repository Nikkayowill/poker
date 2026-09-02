import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ANTE_UP_NONOGRAM_DAILY_WAGERED_LIMIT,
  AnteUpNonogramRequestError,
  hintAnteUpNonogramAttempt,
  openAnteUpNonogram,
  playAnteUpNonogram,
  readAnteUpNonogram,
  resignAnteUpNonogramAttempt,
  strokeAnteUpNonogramCells,
  undoAnteUpNonogramStroke,
} from "./ante-up-nonogram-service";
import {
  __resetAnteUpAttemptsForTest,
  getActiveAnteUpAttempt,
  getAnteUpAttemptById,
  type StoredAnteUpAttempt,
} from "./ante-up-store";
import { adjustGold, ensureProfile } from "./profile-store";
import {
  ANTE_UP_NONOGRAM_TIERS,
  MIN_ANTE_UP_WAGER,
  type AnteUpNonogramAttempt,
} from "@/lib/arcade/ante-up-nonogram";

/**
 * The Ante Up: Nonogram money contract, in memory mode.
 *
 * Same three ordering rules as ante-up-minesweeper-service.test.ts -- the
 * wager leaves exactly once at open, a win credits exactly the settled payout
 * exactly once, and a loss (mistakes spent, timeout or resignation) credits
 * nothing at all.
 *
 * The helpers below read the true answer straight off the store, the same move
 * the Minesweeper tests make against the stored mine layout. A test cannot
 * play this game honestly: the point of the redacted snapshot is that the
 * picture is unknowable from outside.
 */

const GAME = "nonogram";

async function funded(gold = 50_000) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  return { token, id: profile.id };
}

async function balance(token: string): Promise<number> {
  return (await ensureProfile(token)).goldBalance;
}

async function live(profileId: string): Promise<StoredAnteUpAttempt<AnteUpNonogramAttempt>> {
  const stored = await getActiveAnteUpAttempt<AnteUpNonogramAttempt>(profileId, GAME);
  if (!stored) throw new Error("no active attempt");
  return stored;
}

/** By id rather than by "active", since a settled attempt frees the active slot. */
async function byId(attemptId: string): Promise<StoredAnteUpAttempt<AnteUpNonogramAttempt>> {
  const stored = await getAnteUpAttemptById<AnteUpNonogramAttempt>(attemptId);
  if (!stored) throw new Error("attempt vanished");
  return stored;
}

/** Every square the answer fills, and every square it does not. */
async function squares(profileId: string): Promise<{ filled: number[]; empty: number[] }> {
  const { state } = await live(profileId);
  const filled: number[] = [];
  const empty: number[] = [];
  for (let index = 0; index < state.board.solution.length; index += 1) {
    (state.board.solution[index] === "#" ? filled : empty).push(index);
  }
  return { filled, empty };
}

/** Plays the whole picture, one request per square, pinning each to the live version. */
async function winIt(token: string, profileId: string): Promise<string> {
  const attemptId = (await live(profileId)).id;
  const { filled } = await squares(profileId);
  for (const index of filled) {
    const stored = await getAnteUpAttemptById<AnteUpNonogramAttempt>(attemptId);
    if (!stored || stored.state.status !== "active") break;
    await playAnteUpNonogram(token, { version: stored.version, index, mark: "fill" });
  }
  return attemptId;
}

beforeEach(() => {
  __resetAnteUpAttemptsForTest();
});

describe("opening an attempt", () => {
  it("takes the wager once, before the attempt exists", async () => {
    const { token, id } = await funded(10_000);
    const { attempt, profile } = await openAnteUpNonogram(token, "easy", 1000);

    expect(profile.goldBalance).toBe(9000);
    expect(await balance(token)).toBe(9000);
    expect(attempt.wager).toBe(1000);
    expect(attempt.status).toBe("active");
    expect((await live(id)).state.wager).toBe(1000);
  });

  it("charges a free attempt nothing", async () => {
    const { token } = await funded(10_000);
    const { attempt } = await openAnteUpNonogram(token, "easy", 0);
    expect(attempt.wager).toBe(0);
    expect(await balance(token)).toBe(10_000);
  });

  it("refuses a wager the player cannot afford, and takes nothing", async () => {
    const { token } = await funded(600);
    await expect(openAnteUpNonogram(token, "easy", 5000)).rejects.toBeInstanceOf(
      AnteUpNonogramRequestError,
    );
    expect(await balance(token)).toBe(600);
  });

  it("refuses a wager under the floor, or one that is not a whole number", async () => {
    const { token } = await funded();
    await expect(openAnteUpNonogram(token, "easy", MIN_ANTE_UP_WAGER - 1)).rejects.toThrow(
      /at least/,
    );
    await expect(openAnteUpNonogram(token, "easy", 1000.5)).rejects.toThrow(/not a wager/);
    await expect(openAnteUpNonogram(token, "easy", -1)).rejects.toThrow(/not a wager/);
    expect(await balance(token)).toBe(50_000);
  });

  it("refuses a wager over the board's own ceiling, and names the rung that would take it", async () => {
    // Easy caps at 5,000; see lib/arcade/ante-up-stakes.ts.
    const { token } = await funded(1_000_000);
    await expect(openAnteUpNonogram(token, "easy", 25_000)).rejects.toThrow(/caps at 5,000/);
    await expect(openAnteUpNonogram(token, "easy", 25_000)).rejects.toThrow(/Medium/);
    expect(await balance(token)).toBe(1_000_000);
  });

  it("lets a bigger board take a bigger wager", async () => {
    const { token } = await funded(1_000_000);
    const { attempt, profile } = await openAnteUpNonogram(token, "master", 250_000);
    expect(attempt.difficulty).toBe("master");
    expect(attempt.board.size).toBe(25);
    // The returned profile, not a re-read: a wager this size awards enough XP
    // to cross a level, and a level reward is its own credit landing after the
    // debit. Reading the balance back would be measuring both.
    expect(profile.goldBalance).toBe(750_000);
  });

  it("refuses a size it does not offer", async () => {
    const { token } = await funded();
    await expect(openAnteUpNonogram(token, "tiny", 0)).rejects.toThrow(/Pick a size/);
  });

  it("refuses a second attempt while one is live", async () => {
    const { token } = await funded();
    await openAnteUpNonogram(token, "easy", 1000);
    await expect(openAnteUpNonogram(token, "easy", 1000)).rejects.toThrow(/in progress/);
    // And the refused attempt's wager never left the wallet.
    expect(await balance(token)).toBe(49_000);
  });

  it("caps how many wagered attempts a day, but never the free ones", async () => {
    const { token, id } = await funded(1_000_000);
    for (let i = 0; i < ANTE_UP_NONOGRAM_DAILY_WAGERED_LIMIT; i += 1) {
      await openAnteUpNonogram(token, "easy", MIN_ANTE_UP_WAGER);
      await resignAnteUpNonogramAttempt(token);
    }
    await expect(openAnteUpNonogram(token, "easy", MIN_ANTE_UP_WAGER)).rejects.toThrow(/times in the last day/);

    // Free practice is uncapped.
    const { attempt } = await openAnteUpNonogram(token, "easy", 0);
    expect(attempt.wager).toBe(0);
    expect((await live(id)).state.wager).toBe(0);
  });

  it("never puts the answer in what it hands back", async () => {
    const { token, id } = await funded();
    const { attempt } = await openAnteUpNonogram(token, "easy", 1000);
    expect(attempt.board.solution).toBeNull();
    expect(JSON.stringify(attempt)).not.toContain((await live(id)).state.board.solution);
  });
});

describe("playing", () => {
  it("keeps a correct fill and charges no mistake", async () => {
    const { token, id } = await funded();
    await openAnteUpNonogram(token, "easy", 1000);
    const { filled } = await squares(id);
    const stored = await live(id);

    const { attempt } = await playAnteUpNonogram(token, {
      version: stored.version,
      index: filled[0],
      mark: "fill",
    });
    expect(attempt.board.marks[filled[0]]).toBe("#");
    expect(attempt.board.mistakes).toBe(0);
  });

  it("crosses a wrong fill and charges a mistake", async () => {
    const { token, id } = await funded();
    await openAnteUpNonogram(token, "easy", 1000);
    const { empty } = await squares(id);
    const stored = await live(id);

    const { attempt } = await playAnteUpNonogram(token, {
      version: stored.version,
      index: empty[0],
      mark: "fill",
    });
    expect(attempt.board.marks[empty[0]]).toBe("x");
    expect(attempt.board.mistakes).toBe(1);
  });

  it("refuses a mark pinned to a version that has moved on, and returns the true board", async () => {
    const { token, id } = await funded();
    await openAnteUpNonogram(token, "easy", 1000);
    const { filled } = await squares(id);
    const stored = await live(id);
    await playAnteUpNonogram(token, { version: stored.version, index: filled[0], mark: "fill" });

    await expect(
      playAnteUpNonogram(token, { version: stored.version, index: filled[1], mark: "fill" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a mark when there is no attempt at all", async () => {
    const { token } = await funded();
    await expect(playAnteUpNonogram(token, { version: 1, index: 0, mark: "fill" }))
      .rejects.toMatchObject({ status: 404 });
  });

  it("refuses a square the board has already settled", async () => {
    const { token, id } = await funded();
    await openAnteUpNonogram(token, "easy", 1000);
    const { filled } = await squares(id);
    let stored = await live(id);
    await playAnteUpNonogram(token, { version: stored.version, index: filled[0], mark: "fill" });

    stored = await live(id);
    await expect(
      playAnteUpNonogram(token, { version: stored.version, index: filled[0], mark: "cross" }),
    ).rejects.toThrow(/already settled/);
  });
});

describe("settling", () => {
  it("credits exactly the payout, exactly once, on a win", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpNonogram(token, "easy", 1000);
    expect(await balance(token)).toBe(9000);

    const attemptId = await winIt(token, id);
    const settled = await byId(attemptId);
    expect(settled.state.status).toBe("won");

    const payout = Math.round(1000 * ANTE_UP_NONOGRAM_TIERS.easy.multiplier);
    expect(await balance(token)).toBe(9000 + payout);
    // Rule 3: settlement is one credit of stake + net, never a second debit.
    expect(settled.settledAt).not.toBeNull();
  });

  it("credits nothing on a resignation, and does not refund the wager", async () => {
    const { token } = await funded(10_000);
    await openAnteUpNonogram(token, "easy", 1000);
    const { attempt } = await resignAnteUpNonogramAttempt(token);

    expect(attempt?.status).toBe("lost");
    expect(attempt?.payout).toBe(0);
    expect(await balance(token)).toBe(9000);
  });

  it("credits nothing when the mistake budget runs out", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpNonogram(token, "easy", 1000);
    const { empty } = await squares(id);
    const attemptId = (await live(id)).id;

    for (const index of empty) {
      const stored = await getAnteUpAttemptById<AnteUpNonogramAttempt>(attemptId);
      if (!stored || stored.state.status !== "active") break;
      await playAnteUpNonogram(token, { version: stored.version, index, mark: "fill" });
    }

    const settled = await byId(attemptId);
    expect(settled.state.status).toBe("lost");
    expect(await balance(token)).toBe(9000);
  });

  it("settles an expired attempt on the next read, and pays nothing", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpNonogram(token, "easy", 1000);
    const { filled } = await squares(id);
    const stored = await live(id);
    await playAnteUpNonogram(token, { version: stored.version, index: filled[0], mark: "fill" });

    const late = new Date(Date.now() + ANTE_UP_NONOGRAM_TIERS.easy.timeLimitMs + 60_000);
    const { attempt } = await readAnteUpNonogram(token, late);

    expect(attempt?.status).toBe("timed-out");
    expect(attempt?.payout).toBe(0);
    expect(await balance(token)).toBe(9000);
  });

  it("refuses a mark after the clock ran out, and returns the settled board", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpNonogram(token, "easy", 1000);
    const { filled } = await squares(id);
    let stored = await live(id);
    await playAnteUpNonogram(token, { version: stored.version, index: filled[0], mark: "fill" });

    stored = await live(id);
    const late = new Date(Date.now() + ANTE_UP_NONOGRAM_TIERS.easy.timeLimitMs + 60_000);
    await expect(
      playAnteUpNonogram(token, { version: stored.version, index: filled[1], mark: "fill" }, late),
    ).rejects.toThrow(/Time's up/);
    expect(await balance(token)).toBe(9000);
  });

  it("pays a free win nothing at all", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpNonogram(token, "easy", 0);
    const attemptId = await winIt(token, id);

    expect((await byId(attemptId)).state.status).toBe("won");
    expect(await balance(token)).toBe(10_000);
  });

  it("hands the answer over once the attempt is settled", async () => {
    const { token, id } = await funded();
    await openAnteUpNonogram(token, "easy", 1000);
    const solution = (await live(id)).state.board.solution;

    const { attempt } = await resignAnteUpNonogramAttempt(token);
    expect(attempt?.board.solution).toBe(solution);
  });
});

describe("reading", () => {
  it("answers with no attempt when there is none", async () => {
    const { token } = await funded();
    expect((await readAnteUpNonogram(token)).attempt).toBeNull();
  });

  it("restores a live attempt after a refresh, still redacted", async () => {
    const { token } = await funded();
    await openAnteUpNonogram(token, "medium", 1000);

    const { attempt } = await readAnteUpNonogram(token);
    expect(attempt?.status).toBe("active");
    expect(attempt?.difficulty).toBe("medium");
    expect(attempt?.board.size).toBe(10);
    expect(attempt?.board.solution).toBeNull();
  });

  it("frees the slot once an attempt settles", async () => {
    const { token } = await funded();
    await openAnteUpNonogram(token, "easy", 1000);
    await resignAnteUpNonogramAttempt(token);

    expect((await readAnteUpNonogram(token)).attempt).toBeNull();
    // Which is what lets the next one open.
    await expect(openAnteUpNonogram(token, "easy", 1000)).resolves.toBeDefined();
  });

  it("gives a resignation with nothing live a null rather than an error", async () => {
    const { token } = await funded();
    expect((await resignAnteUpNonogramAttempt(token)).attempt).toBeNull();
  });
});

describe("strokes", () => {
  it("pays exactly once for a picture finished by strokes", async () => {
    const { token, id } = await funded(10_000);
    const { attempt } = await openAnteUpNonogram(token, "easy", 1000);
    expect(await balance(token)).toBe(9000);

    const { filled } = await squares(id);
    for (const index of filled) {
      const stored = await getAnteUpAttemptById<AnteUpNonogramAttempt>(attempt.id);
      if (!stored || stored.state.status !== "active") break;
      await strokeAnteUpNonogramCells(token, {
        version: stored.version,
        indexes: [index],
        mark: "fill",
      });
    }

    const done = await byId(attempt.id);
    expect(done.state.status).toBe("won");
    const payout = Math.round(1000 * ANTE_UP_NONOGRAM_TIERS.easy.multiplier);
    expect(await balance(token)).toBe(9000 + payout);
  });

  // The reason a stroke is one request: a bad drag is one wrong assertion.
  it("charges one mistake for a drag that ran past the end of a run", async () => {
    const { token, id } = await funded();
    await openAnteUpNonogram(token, "easy", 0);
    const { empty } = await squares(id);
    const stored = await live(id);

    await strokeAnteUpNonogramCells(token, {
      version: stored.version,
      indexes: empty.slice(0, 3),
      mark: "fill",
    });
    expect((await live(id)).state.board.mistakes).toBe(1);
  });

  it("writes nothing, and burns no version, for a stroke that changes nothing", async () => {
    const { token, id } = await funded();
    await openAnteUpNonogram(token, "easy", 0);
    const before = await live(id);

    const { attempt } = await strokeAnteUpNonogramCells(token, {
      version: before.version,
      indexes: [0, 1, 2],
      mark: "clear",
    });
    expect(attempt.version).toBe(before.version);
    expect((await live(id)).version).toBe(before.version);
  });

  it("refuses a stroke pinned to a version that has moved on, and returns the true board", async () => {
    const { token, id } = await funded();
    await openAnteUpNonogram(token, "easy", 0);
    const { filled } = await squares(id);
    const stored = await live(id);
    await strokeAnteUpNonogramCells(token, {
      version: stored.version,
      indexes: [filled[0]],
      mark: "fill",
    });

    await expect(
      strokeAnteUpNonogramCells(token, {
        version: stored.version,
        indexes: [filled[1]],
        mark: "fill",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("undo and hints", () => {
  it("takes back a stroke of crosses", async () => {
    const { token, id } = await funded();
    await openAnteUpNonogram(token, "easy", 0);
    const { empty } = await squares(id);
    const opened = await live(id);

    await strokeAnteUpNonogramCells(token, {
      version: opened.version,
      indexes: empty.slice(0, 3),
      mark: "cross",
    });
    const marked = await live(id);
    expect(marked.state.board.marks).not.toBe(opened.state.board.marks);

    const { attempt } = await undoAnteUpNonogramStroke(token, { version: marked.version });
    expect(attempt.board.marks).toBe(opened.state.board.marks);
    expect(attempt.board.canUndo).toBe(false);
  });

  it("refuses an undo with nothing to take back", async () => {
    const { token, id } = await funded();
    await openAnteUpNonogram(token, "easy", 0);
    const stored = await live(id);
    await expect(
      undoAnteUpNonogramStroke(token, { version: stored.version }),
    ).rejects.toBeInstanceOf(AnteUpNonogramRequestError);
  });

  it("charges a hint a mistake and gives a square of the picture", async () => {
    const { token, id } = await funded();
    await openAnteUpNonogram(token, "easy", 0);
    const stored = await live(id);

    const { attempt } = await hintAnteUpNonogramAttempt(token, { version: stored.version });
    expect(attempt.board.mistakes).toBe(1);
    expect(attempt.board.hints).toBe(1);
    expect(attempt.board.filled).toBeGreaterThan(0);
  });

  // The mistake is the price, and it is charged inside the engine. What
  // matters here is that a board a hint finished still pays like any other.
  it("pays a wagered board that a hint finished", async () => {
    const { token, id } = await funded(10_000);
    const { attempt } = await openAnteUpNonogram(token, "easy", 1000);
    const { filled } = await squares(id);

    for (const index of filled.slice(0, -1)) {
      const stored = await getAnteUpAttemptById<AnteUpNonogramAttempt>(attempt.id);
      if (!stored || stored.state.status !== "active") break;
      await strokeAnteUpNonogramCells(token, {
        version: stored.version,
        indexes: [index],
        mark: "fill",
      });
    }

    const nearly = await live(id);
    expect(nearly.state.status).toBe("active");
    const { attempt: won } = await hintAnteUpNonogramAttempt(token, { version: nearly.version });
    expect(won.status).toBe("won");
    expect(await balance(token)).toBe(
      9000 + Math.round(1000 * ANTE_UP_NONOGRAM_TIERS.easy.multiplier),
    );
  });

  it("refuses a hint that would spend the last mistake", async () => {
    const { token, id } = await funded();
    await openAnteUpNonogram(token, "easy", 0);
    const { empty } = await squares(id);
    const limit = (await live(id)).state.board.mistakeLimit;

    for (const index of empty.slice(0, limit - 1)) {
      const stored = await live(id);
      await strokeAnteUpNonogramCells(token, {
        version: stored.version,
        indexes: [index],
        mark: "fill",
      });
    }

    const stored = await live(id);
    expect(stored.state.board.mistakes).toBe(limit - 1);
    await expect(
      hintAnteUpNonogramAttempt(token, { version: stored.version }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("the picture", () => {
  it("keeps the drawing's name back until the attempt is settled", async () => {
    const { token } = await funded();
    const { attempt } = await openAnteUpNonogram(token, "easy", 0);
    expect(attempt.board.title).toBeNull();

    const { attempt: done } = await resignAnteUpNonogramAttempt(token);
    expect(done?.board.title).toBeTruthy();
  });

  it("deals a drawing rather than static on every rung that has one", async () => {
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      const { token } = await funded();
      await openAnteUpNonogram(token, difficulty, 0);
      const { attempt } = await resignAnteUpNonogramAttempt(token);
      expect(attempt?.board.title).toBeTruthy();
    }
  });

  it("carries the auto-cross choice from the deal onto the round", async () => {
    const { token } = await funded();
    const off = await openAnteUpNonogram(token, "easy", 0, { autoCross: false });
    expect(off.attempt.board.autoCross).toBe(false);
    await resignAnteUpNonogramAttempt(token);

    const on = await openAnteUpNonogram(token, "easy", 0);
    expect(on.attempt.board.autoCross).toBe(true);
  });
});
