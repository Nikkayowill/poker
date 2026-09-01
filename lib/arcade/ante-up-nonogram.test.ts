import { describe, expect, it } from "vitest";
import {
  ANTE_UP_NONOGRAM_TIERS,
  MIN_ANTE_UP_WAGER,
  anteUpNonogramDeadline,
  anteUpNonogramMarkProblem,
  anteUpNonogramPayout,
  anteUpNonogramSize,
  markAnteUpNonogramCell,
  resignAnteUpNonogram,
  startAnteUpNonogram,
  tickAnteUpNonogram,
  toAnteUpNonogramSnapshot,
  type AnteUpNonogramAttempt,
} from "./ante-up-nonogram";
import { NONOGRAM_DIFFICULTIES } from "./puzzles/nonogram";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const META = { id: "attempt-1", version: 3 };

function attempt(wager = 1000): AnteUpNonogramAttempt {
  return startAnteUpNonogram("easy", wager, 2026, NOW);
}

/** Fills every square of the answer, in order. The shortest winning line. */
function solve(current: AnteUpNonogramAttempt, now = NOW): AnteUpNonogramAttempt {
  let state = current;
  for (let index = 0; index < state.board.solution.length; index += 1) {
    if (state.board.solution[index] === "#") {
      state = markAnteUpNonogramCell(state, index, "fill", now);
    }
  }
  return state;
}

/** Spends the whole mistake budget on squares the answer leaves empty. */
function burnBudget(current: AnteUpNonogramAttempt, now = NOW): AnteUpNonogramAttempt {
  let state = current;
  for (let index = 0; index < state.board.solution.length; index += 1) {
    if (state.status !== "active") break;
    if (state.board.solution[index] === ".") {
      state = markAnteUpNonogramCell(state, index, "fill", now);
    }
  }
  return state;
}

describe("the tier ladder", () => {
  it("has a rung for every board size, and no others", () => {
    expect(Object.keys(ANTE_UP_NONOGRAM_TIERS).sort())
      .toEqual(NONOGRAM_DIFFICULTIES.map((entry) => entry.id).sort());
  });

  it("grows the clock and the multiplier together, up the ladder", () => {
    const rungs = NONOGRAM_DIFFICULTIES.map((entry) => ANTE_UP_NONOGRAM_TIERS[entry.id]);
    for (let i = 1; i < rungs.length; i += 1) {
      expect(rungs[i].timeLimitMs).toBeGreaterThan(rungs[i - 1].timeLimitMs);
      expect(rungs[i].multiplier).toBeGreaterThan(rungs[i - 1].multiplier);
    }
  });

  it("keeps the easiest board close to break-even, per the economy guard", () => {
    // A 5x5 with four minutes on it is close to a certain win, and a certain
    // win paying well over 1x is the money printer lib/arcade/ante-up-stakes.ts
    // was written to close. See its header.
    expect(ANTE_UP_NONOGRAM_TIERS.easy.multiplier).toBeLessThanOrEqual(1.1);
  });

  it("names the board width behind a difficulty, for copy that quotes it", () => {
    expect(anteUpNonogramSize("easy")).toBe(5);
    expect(anteUpNonogramSize("master")).toBe(25);
  });
});

describe("opening an attempt", () => {
  it("copies the terms onto the attempt rather than leaving them to be re-read", () => {
    const state = attempt();
    expect(state.multiplier).toBe(ANTE_UP_NONOGRAM_TIERS.easy.multiplier);
    expect(state.timeLimitMs).toBe(ANTE_UP_NONOGRAM_TIERS.easy.timeLimitMs);
    expect(state.board.mistakeLimit).toBe(3);
    expect(state.wager).toBe(1000);
    expect(state.status).toBe("active");
  });

  it("leaves the clock unstarted until the first square", () => {
    const state = attempt();
    expect(anteUpNonogramDeadline(state)).toBeNull();
    expect(tickAnteUpNonogram(state, new Date(NOW.getTime() + 60 * 60_000))).toBeNull();
  });

  it("starts the deadline from the first square, not from opening", () => {
    const opened = attempt();
    const later = new Date(NOW.getTime() + 5 * 60_000);
    const played = markAnteUpNonogramCell(opened, opened.board.solution.indexOf("#"), "fill", later);
    expect(anteUpNonogramDeadline(played))
      .toBe(later.getTime() + ANTE_UP_NONOGRAM_TIERS.easy.timeLimitMs);
  });
});

describe("the clock", () => {
  it("returns null from tick when nothing changed, so a poll cannot livelock the version guard", () => {
    const opened = attempt();
    const played = markAnteUpNonogramCell(opened, opened.board.solution.indexOf("#"), "fill", NOW);
    expect(tickAnteUpNonogram(played, NOW)).toBeNull();
    expect(tickAnteUpNonogram(played, new Date(NOW.getTime() + 1000))).toBeNull();
  });

  it("times the attempt out once the deadline passes", () => {
    const opened = attempt();
    const played = markAnteUpNonogramCell(opened, opened.board.solution.indexOf("#"), "fill", NOW);
    const late = new Date(NOW.getTime() + ANTE_UP_NONOGRAM_TIERS.easy.timeLimitMs + 1);

    const ticked = tickAnteUpNonogram(played, late);
    expect(ticked?.status).toBe("timed-out");
    expect(ticked?.board.status).toBe("lost");
    // And once settled, it never ticks again.
    expect(tickAnteUpNonogram(ticked!, late)).toBeNull();
  });

  it("refuses a mark that arrives after the deadline", () => {
    const opened = attempt();
    const played = markAnteUpNonogramCell(opened, opened.board.solution.indexOf("#"), "fill", NOW);
    const late = new Date(NOW.getTime() + ANTE_UP_NONOGRAM_TIERS.easy.timeLimitMs + 1);
    const other = played.board.solution.indexOf("#", played.board.solution.indexOf("#") + 1);

    expect(anteUpNonogramMarkProblem(played, other, "fill", late)).toBe("finished");
    expect(markAnteUpNonogramCell(played, other, "fill", late)).toBe(played);
  });
});

describe("settling", () => {
  it("wins once every square of the picture is filled", () => {
    const done = solve(attempt());
    expect(done.status).toBe("won");
    expect(anteUpNonogramPayout(done)).toBe(Math.round(1000 * ANTE_UP_NONOGRAM_TIERS.easy.multiplier));
  });

  it("loses once the mistake budget is spent, and pays nothing", () => {
    const done = burnBudget(attempt());
    expect(done.status).toBe("lost");
    expect(done.board.mistakes).toBe(done.board.mistakeLimit);
    expect(anteUpNonogramPayout(done)).toBe(0);
  });

  it("pays nothing on a timeout or a resignation either", () => {
    const opened = attempt();
    const played = markAnteUpNonogramCell(opened, opened.board.solution.indexOf("#"), "fill", NOW);
    const late = new Date(NOW.getTime() + ANTE_UP_NONOGRAM_TIERS.easy.timeLimitMs + 1);

    expect(anteUpNonogramPayout(tickAnteUpNonogram(played, late)!)).toBe(0);
    expect(anteUpNonogramPayout(resignAnteUpNonogram(played, NOW))).toBe(0);
  });

  it("pays a free attempt nothing, whatever it does", () => {
    expect(anteUpNonogramPayout(solve(attempt(0)))).toBe(0);
  });

  it("pays at the multiplier the attempt stored, not the one the table holds now", () => {
    // The retune this rule exists for: a live attempt keeps the terms it was
    // opened on. See lib/arcade/ante-up-ladder.ts's header.
    const done = { ...solve(attempt()), multiplier: 9 };
    expect(anteUpNonogramPayout(done)).toBe(9000);
  });

  it("leaves a finished attempt alone on a later resignation", () => {
    const done = solve(attempt());
    expect(resignAnteUpNonogram(done, NOW)).toBe(done);
  });

  it("refuses a mark once the attempt is over", () => {
    const done = solve(attempt());
    expect(anteUpNonogramMarkProblem(done, 0, "fill", NOW)).toBe("finished");
  });
});

describe("the snapshot", () => {
  it("withholds the answer while the attempt is live", () => {
    const snapshot = toAnteUpNonogramSnapshot(attempt(), META, NOW);
    expect(snapshot.board.solution).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain(attempt().board.solution);
  });

  it("hands the answer over once it is settled, so the board can show what was missed", () => {
    const done = resignAnteUpNonogram(attempt(), NOW);
    expect(toAnteUpNonogramSnapshot(done, META, NOW).board.solution).toBe(done.board.solution);
  });

  it("states the payout rather than leaving the client to work it out", () => {
    const done = solve(attempt());
    expect(toAnteUpNonogramSnapshot(done, META, NOW).payout)
      .toBe(Math.round(1000 * ANTE_UP_NONOGRAM_TIERS.easy.multiplier));
    expect(toAnteUpNonogramSnapshot(attempt(), META, NOW).payout).toBe(0);
  });

  it("gives an absolute deadline and a live countdown, or null before the clock starts", () => {
    const fresh = toAnteUpNonogramSnapshot(attempt(), META, NOW);
    expect(fresh.expiresAt).toBeNull();
    expect(fresh.msRemaining).toBeNull();

    const opened = attempt();
    const played = markAnteUpNonogramCell(opened, opened.board.solution.indexOf("#"), "fill", NOW);
    const thirtyIn = new Date(NOW.getTime() + 30_000);
    const live = toAnteUpNonogramSnapshot(played, META, thirtyIn);
    expect(live.expiresAt).toBe(
      new Date(NOW.getTime() + ANTE_UP_NONOGRAM_TIERS.easy.timeLimitMs).toISOString(),
    );
    expect(live.msRemaining).toBe(ANTE_UP_NONOGRAM_TIERS.easy.timeLimitMs - 30_000);
  });

  it("floors the countdown at zero once the attempt is settled", () => {
    const opened = attempt();
    const played = markAnteUpNonogramCell(opened, opened.board.solution.indexOf("#"), "fill", NOW);
    const late = new Date(NOW.getTime() + ANTE_UP_NONOGRAM_TIERS.easy.timeLimitMs + 5000);
    expect(toAnteUpNonogramSnapshot(tickAnteUpNonogram(played, late)!, META, late).msRemaining).toBe(0);
  });

  it("carries the id and version the caller has to pin its next mark to", () => {
    const snapshot = toAnteUpNonogramSnapshot(attempt(), META, NOW);
    expect(snapshot.id).toBe("attempt-1");
    expect(snapshot.version).toBe(3);
  });
});

describe("the wager floor", () => {
  it("is the same number every Ante Up game restates", () => {
    expect(MIN_ANTE_UP_WAGER).toBe(500);
  });
});
