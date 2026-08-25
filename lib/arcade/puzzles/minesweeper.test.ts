import { describe, expect, it } from "vitest";

import {
  CELL_EXPLODED,
  CELL_HIDDEN,
  CELL_MINE,
  CELL_WRONG_FLAG,
  MINESWEEPER_DIFFICULTIES,
  chordMinesweeperCell,
  isMinesweeperDifficulty,
  isNoGuessBoard,
  minesweeperChordProblem,
  minesweeperElapsedMs,
  minesweeperRevealProblem,
  minesweeperView,
  resignMinesweeperRound,
  revealMinesweeperCell,
  startMinesweeperRound,
  toggleMinesweeperFlag,
  type MinesweeperDifficulty,
  type MinesweeperRound,
} from "./minesweeper";

const NOW = new Date("2026-08-24T12:00:00.000Z");
const LATER = new Date("2026-08-24T12:01:30.000Z");

function opened(difficulty: MinesweeperDifficulty, seed: number, start: number): MinesweeperRound {
  return revealMinesweeperCell(startMinesweeperRound(difficulty, seed), start, NOW);
}

function neighborsOf(index: number, cols: number, rows: number): number[] {
  const row = Math.floor(index / cols);
  const col = index % cols;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      out.push(r * cols + c);
    }
  }
  return out;
}

/** Plays a board out with perfect information -- the only way to reach a clear in a test. */
function clearBoard(round: MinesweeperRound): MinesweeperRound {
  const mines = new Set(round.mines ?? []);
  let current = round;
  for (let i = 0; i < current.cols * current.rows; i += 1) {
    if (!mines.has(i)) current = revealMinesweeperCell(current, i, LATER);
  }
  return current;
}

describe("dealing a round", () => {
  it("holds no mines until the first reveal", () => {
    const round = startMinesweeperRound("beginner", 7);
    expect(round.mines).toBeNull();
    expect(round.status).toBe("active");
    expect(round.startedAt).toBeNull();
  });

  it("recognises its own difficulty ids and rejects anything else", () => {
    expect(isMinesweeperDifficulty("expert")).toBe(true);
    expect(isMinesweeperDifficulty("impossible")).toBe(false);
  });

  it("keeps the first click and every cell touching it clear of mines", () => {
    for (const config of MINESWEEPER_DIFFICULTIES) {
      for (let seed = 1; seed <= 10; seed += 1) {
        const start = (seed * 13) % (config.cols * config.rows);
        const round = opened(config.id, seed, start);
        const mines = new Set(round.mines ?? []);
        expect(mines.size).toBe(config.mines);
        expect(mines.has(start)).toBe(false);
        for (const n of neighborsOf(start, config.cols, config.rows)) {
          expect(mines.has(n)).toBe(false);
        }
        expect(round.status).toBe("active");
      }
    }
  });

  it("opens a whole region on the first click, never a lone cell", () => {
    // The opening click has no adjacent mines by construction, so it always cascades.
    for (let seed = 1; seed <= 5; seed += 1) {
      expect(opened("beginner", seed, 40).revealed.length).toBeGreaterThan(1);
    }
  });

  it("starts the clock on the first click, not when the round was dealt", () => {
    const round = opened("beginner", 3, 40);
    expect(round.startedAt).toBe(NOW.toISOString());
    expect(startMinesweeperRound("beginner", 3).startedAt).toBeNull();
  });

  it("lays the same board for the same seed and first click", () => {
    expect(opened("intermediate", 42, 60).mines).toEqual(opened("intermediate", 42, 60).mines);
  });

  it("lays a different board for a different seed", () => {
    expect(opened("intermediate", 42, 60).mines).not.toEqual(opened("intermediate", 43, 60).mines);
  });

  it("lays a different board when the same seed is opened somewhere else", () => {
    expect(opened("intermediate", 42, 60).mines).not.toEqual(opened("intermediate", 42, 12).mines);
  });
});

describe("board quality", () => {
  it("lays boards that can always be finished by logic alone", () => {
    // The whole reason placeMines retries. A board needing a coin flip at the
    // end would make this a slot machine, and it settles real Gold.
    for (const config of MINESWEEPER_DIFFICULTIES) {
      for (let seed = 1; seed <= 6; seed += 1) {
        const start = Math.floor((config.cols * config.rows) / 2);
        const round = opened(config.id, seed, start);
        const solvable = isNoGuessBoard(
          new Set(round.mines ?? []),
          start,
          config.cols,
          config.rows,
        );
        expect(solvable).toBe(true);
      }
    }
  });

  it("rejects a board that needs a guess", () => {
    // A 1x3 strip with one mine somewhere in it: opening the middle tells you
    // nothing about which end holds it, so this must not pass.
    expect(isNoGuessBoard(new Set([0]), 1, 3, 1)).toBe(false);
  });
});

describe("revealing", () => {
  it("refuses a cell that is already open, flagged, or off the board", () => {
    const round = opened("beginner", 5, 40);
    const openCell = round.revealed[0];
    expect(minesweeperRevealProblem(round, openCell)).toBe("already-open");
    expect(minesweeperRevealProblem(round, -1)).toBe("out-of-bounds");
    expect(minesweeperRevealProblem(round, 81)).toBe("out-of-bounds");

    const hidden = [...Array(81).keys()].find((i) => !round.revealed.includes(i)) as number;
    const flagged = toggleMinesweeperFlag(round, hidden);
    expect(minesweeperRevealProblem(flagged, hidden)).toBe("flagged");
    expect(revealMinesweeperCell(flagged, hidden, LATER)).toBe(flagged);
  });

  it("ends the round when a mine is opened", () => {
    const round = opened("beginner", 9, 40);
    const mine = (round.mines as number[])[0];
    const lost = revealMinesweeperCell(round, mine, LATER);
    expect(lost.status).toBe("lost");
    expect(lost.explodedAt).toBe(mine);
    expect(lost.endedAt).toBe(LATER.toISOString());
  });

  it("clears the round once every safe cell is open", () => {
    const cleared = clearBoard(opened("beginner", 11, 40));
    expect(cleared.status).toBe("cleared");
    expect(cleared.revealed.length).toBe(81 - 10);
    expect(cleared.endedAt).toBe(LATER.toISOString());
  });

  it("ignores every move once the round is over", () => {
    const round = opened("beginner", 9, 40);
    const lost = revealMinesweeperCell(round, (round.mines as number[])[0], LATER);
    expect(revealMinesweeperCell(lost, 0, LATER)).toBe(lost);
    expect(toggleMinesweeperFlag(lost, 0)).toBe(lost);
    expect(chordMinesweeperCell(lost, 0, LATER)).toBe(lost);
    expect(resignMinesweeperRound(lost, LATER)).toBe(lost);
  });
});

describe("flagging", () => {
  it("toggles a flag on and off without laying mines or starting the clock", () => {
    const fresh = startMinesweeperRound("beginner", 5);
    const flagged = toggleMinesweeperFlag(fresh, 12);
    expect(flagged.flags).toEqual([12]);
    expect(flagged.mines).toBeNull();
    expect(flagged.startedAt).toBeNull();
    expect(toggleMinesweeperFlag(flagged, 12).flags).toEqual([]);
  });

  it("refuses to flag an already-open cell", () => {
    const round = opened("beginner", 5, 40);
    expect(toggleMinesweeperFlag(round, round.revealed[0])).toBe(round);
  });
});

describe("chording", () => {
  function firstNumberWithHiddenNeighbours(round: MinesweeperRound): number {
    const mines = new Set(round.mines ?? []);
    return round.revealed.find((i) => {
      const around = neighborsOf(i, round.cols, round.rows);
      return (
        around.some((n) => mines.has(n)) &&
        around.some((n) => !mines.has(n) && !round.revealed.includes(n))
      );
    }) as number;
  }

  it("refuses until the flags around a number match it", () => {
    const round = opened("beginner", 4, 40);
    const numbered = firstNumberWithHiddenNeighbours(round);
    expect(minesweeperChordProblem(round, numbered)).toBe("flags-do-not-match");
    expect(chordMinesweeperCell(round, numbered, LATER)).toBe(round);
  });

  it("refuses on a cell that is not open", () => {
    const round = opened("beginner", 4, 40);
    const hidden = [...Array(81).keys()].find((i) => !round.revealed.includes(i)) as number;
    expect(minesweeperChordProblem(round, hidden)).toBe("not-open");
  });

  it("opens the rest of a number once its mines are correctly flagged", () => {
    const round = opened("beginner", 4, 40);
    const mines = new Set(round.mines ?? []);
    const numbered = firstNumberWithHiddenNeighbours(round);

    let flagged = round;
    for (const n of neighborsOf(numbered, 9, 9)) {
      if (mines.has(n)) flagged = toggleMinesweeperFlag(flagged, n);
    }
    const chorded = chordMinesweeperCell(flagged, numbered, LATER);
    expect(chorded.revealed.length).toBeGreaterThan(flagged.revealed.length);
    expect(chorded.status).toBe("active");
  });

  it("loses when the flags are the right count but on the wrong cells", () => {
    const round = opened("beginner", 4, 40);
    const mines = new Set(round.mines ?? []);
    const numbered = firstNumberWithHiddenNeighbours(round);
    const around = neighborsOf(numbered, 9, 9);
    const mineNeighbours = around.filter((n) => mines.has(n));
    const safeHidden = around.filter((n) => !mines.has(n) && !round.revealed.includes(n));

    // Same number of flags the cell wants, but one of them is deliberately wrong.
    let flagged = toggleMinesweeperFlag(round, safeHidden[0]);
    for (let i = 0; i < mineNeighbours.length - 1; i += 1) {
      flagged = toggleMinesweeperFlag(flagged, mineNeighbours[i]);
    }
    expect(chordMinesweeperCell(flagged, numbered, LATER).status).toBe("lost");
  });
});

describe("the view the browser gets", () => {
  it("never carries a mine position while the round is live", () => {
    const round = opened("intermediate", 21, 60);
    const view = minesweeperView(round);
    expect(view.cells).not.toContain(CELL_MINE);
    expect(view.cells).not.toContain(CELL_EXPLODED);
    expect(view.cells).not.toContain(CELL_WRONG_FLAG);
    // Every hidden cell reads identically whether or not a mine sits under it.
    for (const mine of round.mines as number[]) {
      expect(view.cells[mine]).toBe(CELL_HIDDEN);
    }
  });

  it("shows every mine, and marks the wrong flags, once the round is lost", () => {
    const round = opened("beginner", 9, 40);
    const mines = round.mines as number[];
    const safeHidden = [...Array(81).keys()].find(
      (i) => !round.revealed.includes(i) && !mines.includes(i),
    ) as number;

    const misflagged = toggleMinesweeperFlag(round, safeHidden);
    const view = minesweeperView(revealMinesweeperCell(misflagged, mines[0], LATER));

    expect(view.cells[mines[0]]).toBe(CELL_EXPLODED);
    expect(view.cells.filter((c) => c === CELL_MINE).length).toBe(9);
    expect(view.cells[safeHidden]).toBe(CELL_WRONG_FLAG);
  });

  it("counts the mines down as flags go on, and below zero if you over-flag", () => {
    let round = startMinesweeperRound("beginner", 2);
    round = toggleMinesweeperFlag(round, 0);
    expect(minesweeperView(round).minesLeft).toBe(9);
    for (let i = 1; i <= 10; i += 1) round = toggleMinesweeperFlag(round, i);
    expect(minesweeperView(round).minesLeft).toBe(-1);
  });

  it("tells a blown-up board apart from one that was given up on", () => {
    // Both settle as status "lost" -- the stored status column is a CHECK over
    // exactly ('active','won','lost','timed-out'), so explodedAt is what the UI
    // has to read to avoid telling a player who hit a mine that they gave up.
    const round = opened("beginner", 9, 40);
    const blownUp = revealMinesweeperCell(round, (round.mines as number[])[0], LATER);
    const gaveUp = resignMinesweeperRound(round, LATER);

    expect(blownUp.status).toBe("lost");
    expect(gaveUp.status).toBe("lost");
    expect(minesweeperView(blownUp).explodedAt).not.toBeNull();
    expect(minesweeperView(gaveUp).explodedAt).toBeNull();
  });

  it("flags the last mines for you on a clear", () => {
    const view = minesweeperView(clearBoard(opened("beginner", 11, 40)));
    expect(view.flags.length).toBe(10);
    expect(view.minesLeft).toBe(0);
  });
});

describe("resigning and the clock", () => {
  it("ends an active round as a loss", () => {
    const resigned = resignMinesweeperRound(opened("beginner", 5, 40), LATER);
    expect(resigned.status).toBe("lost");
    expect(resigned.endedAt).toBe(LATER.toISOString());
  });

  it("reports zero elapsed before the first click, then runs, then freezes", () => {
    const fresh = startMinesweeperRound("beginner", 5);
    expect(minesweeperElapsedMs(fresh, LATER)).toBe(0);

    const live = opened("beginner", 5, 40);
    expect(minesweeperElapsedMs(live, LATER)).toBe(90_000);

    const done = resignMinesweeperRound(live, LATER);
    expect(minesweeperElapsedMs(done, new Date("2026-08-24T13:00:00.000Z"))).toBe(90_000);
  });
});
