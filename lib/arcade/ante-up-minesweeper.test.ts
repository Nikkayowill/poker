import { describe, expect, it } from "vitest";

import {
  ANTE_UP_MINESWEEPER_TIERS,
  MIN_ANTE_UP_WAGER,
  anteUpMinesweeperDeadline,
  anteUpMinesweeperPayout,
  anteUpMinesweeperRevealProblem,
  chordAnteUpMinesweeperCell,
  flagAnteUpMinesweeperCell,
  resignAnteUpMinesweeper,
  revealAnteUpMinesweeperCell,
  startAnteUpMinesweeper,
  tickAnteUpMinesweeper,
  toAnteUpMinesweeperSnapshot,
  type AnteUpMinesweeperAttempt,
} from "./ante-up-minesweeper";
import { CELL_HIDDEN, CELL_MINE } from "./puzzles/minesweeper";

const NOW = new Date("2026-08-24T12:00:00.000Z");

function at(ms: number): Date {
  return new Date(NOW.getTime() + ms);
}

function open(difficulty: "beginner" | "expert" = "beginner", wager = 1000) {
  return startAnteUpMinesweeper(difficulty, wager, 11, NOW);
}

/** Opens the board so the clock is running, using a first click known to cascade. */
function started(wager = 1000): AnteUpMinesweeperAttempt {
  return revealAnteUpMinesweeperCell(open("beginner", wager), 40, NOW);
}

function clearBoard(attempt: AnteUpMinesweeperAttempt, now: Date): AnteUpMinesweeperAttempt {
  const mines = new Set(attempt.board.mines ?? []);
  let current = attempt;
  for (let i = 0; i < 81; i += 1) {
    if (!mines.has(i)) current = revealAnteUpMinesweeperCell(current, i, now);
  }
  return current;
}

describe("opening an attempt", () => {
  it("copies the tier onto the attempt rather than looking it up at settlement", () => {
    const attempt = open("expert");
    expect(attempt.multiplier).toBe(ANTE_UP_MINESWEEPER_TIERS.expert.multiplier);
    expect(attempt.timeLimitMs).toBe(ANTE_UP_MINESWEEPER_TIERS.expert.timeLimitMs);
    expect(attempt.status).toBe("active");
  });

  it("keeps the wager floor above zero", () => {
    expect(MIN_ANTE_UP_WAGER).toBeGreaterThan(0);
  });

  it("has no deadline until the first click", () => {
    expect(anteUpMinesweeperDeadline(open())).toBeNull();
    expect(anteUpMinesweeperDeadline(started())).toBe(NOW.getTime() + ANTE_UP_MINESWEEPER_TIERS.beginner.timeLimitMs);
  });

  it("pays a harder tier more", () => {
    expect(ANTE_UP_MINESWEEPER_TIERS.expert.multiplier).toBeGreaterThan(
      ANTE_UP_MINESWEEPER_TIERS.intermediate.multiplier,
    );
    expect(ANTE_UP_MINESWEEPER_TIERS.intermediate.multiplier).toBeGreaterThan(
      ANTE_UP_MINESWEEPER_TIERS.beginner.multiplier,
    );
  });
});

describe("the clock", () => {
  it("does not tick an attempt whose board has never been touched", () => {
    // No first click means no clock, however long the attempt has sat there.
    expect(tickAnteUpMinesweeper(open(), at(60 * 60 * 1000))).toBeNull();
  });

  it("returns null before the deadline", () => {
    expect(tickAnteUpMinesweeper(started(), at(60_000))).toBeNull();
  });

  it("times the attempt out exactly at the deadline", () => {
    const timedOut = tickAnteUpMinesweeper(started(), at(ANTE_UP_MINESWEEPER_TIERS.beginner.timeLimitMs));
    expect(timedOut?.status).toBe("timed-out");
    expect(timedOut?.board.status).toBe("lost");
  });

  it("returns null once already settled, so a poll cannot bump the version forever", () => {
    const timedOut = tickAnteUpMinesweeper(
      started(),
      at(ANTE_UP_MINESWEEPER_TIERS.beginner.timeLimitMs),
    ) as AnteUpMinesweeperAttempt;
    expect(tickAnteUpMinesweeper(timedOut, at(60 * 60 * 1000))).toBeNull();
  });

  it("refuses every move once the clock has run out, even before a tick lands", () => {
    const late = at(ANTE_UP_MINESWEEPER_TIERS.beginner.timeLimitMs + 1);
    const attempt = started();
    const hidden = [...Array(81).keys()].find((i) => !attempt.board.revealed.includes(i)) as number;

    expect(anteUpMinesweeperRevealProblem(attempt, hidden, late)).toBe("finished");
    expect(revealAnteUpMinesweeperCell(attempt, hidden, late)).toBe(attempt);
    expect(flagAnteUpMinesweeperCell(attempt, hidden, late)).toBe(attempt);
    expect(chordAnteUpMinesweeperCell(attempt, attempt.board.revealed[0], late)).toBe(attempt);
  });
});

describe("settlement", () => {
  it("wins when the board clears", () => {
    const won = clearBoard(started(), at(30_000));
    expect(won.status).toBe("won");
  });

  it("loses when a mine is opened", () => {
    const attempt = started();
    const lost = revealAnteUpMinesweeperCell(attempt, (attempt.board.mines as number[])[0], at(1_000));
    expect(lost.status).toBe("lost");
  });

  it("ends as a loss on resignation", () => {
    expect(resignAnteUpMinesweeper(started(), at(1_000)).status).toBe("lost");
    expect(resignAnteUpMinesweeper(open(), at(1_000)).status).toBe("lost");
  });

  it("does nothing when resigning an attempt that already ended", () => {
    const lost = resignAnteUpMinesweeper(started(), at(1_000));
    expect(resignAnteUpMinesweeper(lost, at(2_000))).toBe(lost);
  });
});

describe("payout", () => {
  it("pays wager times multiplier on a win, rounded", () => {
    const won = clearBoard(started(999), at(30_000));
    expect(anteUpMinesweeperPayout(won)).toBe(Math.round(999 * ANTE_UP_MINESWEEPER_TIERS.beginner.multiplier));
  });

  it("pays nothing on a loss, a timeout, or a resignation", () => {
    const attempt = started();
    const lost = revealAnteUpMinesweeperCell(attempt, (attempt.board.mines as number[])[0], at(1_000));
    const timedOut = tickAnteUpMinesweeper(
      started(),
      at(ANTE_UP_MINESWEEPER_TIERS.beginner.timeLimitMs),
    ) as AnteUpMinesweeperAttempt;

    expect(anteUpMinesweeperPayout(lost)).toBe(0);
    expect(anteUpMinesweeperPayout(timedOut)).toBe(0);
    expect(anteUpMinesweeperPayout(resignAnteUpMinesweeper(started(), at(1_000)))).toBe(0);
  });

  it("pays nothing for a free win, since nothing was staked", () => {
    expect(anteUpMinesweeperPayout(clearBoard(started(0), at(30_000)))).toBe(0);
  });

  it("pays nothing on an attempt still in progress", () => {
    expect(anteUpMinesweeperPayout(started())).toBe(0);
  });
});

describe("the snapshot the browser gets", () => {
  it("never carries a mine position while the attempt is live", () => {
    const attempt = started();
    const snapshot = toAnteUpMinesweeperSnapshot(attempt, { id: "a1", version: 2 }, at(5_000));
    expect(snapshot.board.cells).not.toContain(CELL_MINE);
    for (const mine of attempt.board.mines as number[]) {
      expect(snapshot.board.cells[mine]).toBe(CELL_HIDDEN);
    }
  });

  it("carries neither the mine list nor the seed that would reproduce it", () => {
    // The layout is deterministic from (seed, first click), so shipping the
    // seed would be exactly as bad as shipping the mines: a player who had it
    // could rebuild the board offline. Asserted on the serialized snapshot
    // rather than the type, since a leak would be an extra field at runtime.
    // A long, distinctive seed, so "is it in the payload" is a real question
    // rather than a two-digit substring that could pass by coincidence.
    const seed = 1_987_654_321;
    const attempt = revealAnteUpMinesweeperCell(
      startAnteUpMinesweeper("beginner", 1000, seed, NOW),
      40,
      NOW,
    );
    const wire = JSON.stringify(
      toAnteUpMinesweeperSnapshot(attempt, { id: "a1", version: 2 }, at(5_000)),
    );

    expect(attempt.board.seed).toBe(seed);
    expect(wire).not.toContain("seed");
    expect(wire).not.toContain(String(seed));
    expect(JSON.parse(wire).board.mines).toBeUndefined();
    // And the mine indices themselves are not hiding in any other field.
    const cells = JSON.parse(wire).board.cells as number[];
    for (const mine of attempt.board.mines as number[]) {
      expect(cells[mine]).toBe(CELL_HIDDEN);
    }
  });

  it("states the payout rather than leaving the client to work it out", () => {
    const won = clearBoard(started(1000), at(30_000));
    const snapshot = toAnteUpMinesweeperSnapshot(won, { id: "a1", version: 9 }, at(30_000));
    expect(snapshot.payout).toBe(anteUpMinesweeperPayout(won));
    expect(snapshot.payout).toBeGreaterThan(0);
  });

  it("counts the clock down and floors it at zero", () => {
    const attempt = started();
    const limit = ANTE_UP_MINESWEEPER_TIERS.beginner.timeLimitMs;
    expect(toAnteUpMinesweeperSnapshot(attempt, { id: "a", version: 1 }, at(60_000)).msRemaining).toBe(
      limit - 60_000,
    );
    expect(
      toAnteUpMinesweeperSnapshot(attempt, { id: "a", version: 1 }, at(limit + 60_000)).msRemaining,
    ).toBe(0);
  });

  it("reports no clock before the first click", () => {
    const snapshot = toAnteUpMinesweeperSnapshot(open(), { id: "a", version: 1 }, at(60_000));
    expect(snapshot.msRemaining).toBeNull();
    expect(snapshot.elapsedMs).toBe(0);
  });
});
