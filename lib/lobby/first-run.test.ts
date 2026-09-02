import { describe, expect, it } from "vitest";
import { ARCADE_GAMES } from "@/lib/arcade/games";
import {
  FIRST_RUN_DONE,
  FIRST_RUN_STEPS,
  ARCADE_GAME_COUNT,
  FREE_TO_PLAY_COUNT,
  firstRunProgressLabel,
  isFirstRunRetired,
  nextFirstRunStep,
  shouldShowFirstRun,
} from "./first-run";

describe("first-run steps", () => {
  it("offers three steps, each with a distinct id", () => {
    expect(FIRST_RUN_STEPS).toHaveLength(3);
    expect(new Set(FIRST_RUN_STEPS.map((step) => step.id)).size).toBe(3);
  });

  it("only links to arcade routes the catalogue says exist", () => {
    // The catalogue's own live-iff-href test guarantees a live entry has a
    // route; this guarantees onboarding never sends a first-time player to one
    // that is not live. A 404 on step two of somebody's first session is the
    // most expensive 404 in the app.
    const liveHrefs = new Set(
      ARCADE_GAMES.filter((game) => game.status === "live").map((game) => game.href),
    );
    for (const step of FIRST_RUN_STEPS) {
      if (step.action.kind !== "link") continue;
      if (step.action.href === "/games") continue; // the arcade index, not a game
      expect(liveHrefs.has(step.action.href)).toBe(true);
    }
  });

  it("counts the free-to-play games rather than restating them", () => {
    // Not `kind === "puzzle"`: that bucket has been empty since every brain
    // game moved to `kind: "wager"`, and counting it printed a literal "0
    // puzzles are free every day" at a new player. See the constant's own note.
    const counted = ARCADE_GAMES.filter(
      (g) => (g.kind === "puzzle" || g.kind === "wager") && g.status === "live",
    ).length;
    expect(FREE_TO_PLAY_COUNT).toBe(counted);
    expect(counted).toBeGreaterThan(0);
    // The number has to reach the copy, or deriving it bought nothing.
    const free = FIRST_RUN_STEPS.find((step) => step.id === "free");
    expect(free?.body.startsWith(`${counted} `)).toBe(true);
  });

  it("counts the arcade itself rather than restating it", () => {
    // This step read "Ten more games" while the catalogue held thirteen.
    const counted = ARCADE_GAMES.filter((g) => g.status === "live").length;
    expect(ARCADE_GAME_COUNT).toBe(counted);
    const arcade = FIRST_RUN_STEPS.find((step) => step.id === "arcade");
    expect(arcade?.body.startsWith(`${counted} `)).toBe(true);
  });
});

describe("isFirstRunRetired", () => {
  it("shows the strip to a player with nothing stored", () => {
    expect(isFirstRunRetired(null)).toBe(false);
  });

  it("retires once the flag is present", () => {
    // Written by finishing the strip, and by reaching a table -- see the write
    // in components/poker-app.tsx, which is the load-bearing one: a player who
    // ignored the strip and just tapped the table has answered its question.
    expect(isFirstRunRetired(FIRST_RUN_DONE)).toBe(true);
  });

  it("treats an unrecognised stored value as not yet retired", () => {
    // Deliberately the opposite default from the sound/music preferences,
    // whose convention is "on unless exactly false". Failing open here would
    // hide onboarding from the one player who needs it, which is the failure
    // nothing on screen would ever explain.
    expect(isFirstRunRetired("")).toBe(false);
    expect(isFirstRunRetired("true")).toBe(false);
    expect(isFirstRunRetired("1")).toBe(false);
  });
});

describe("shouldShowFirstRun", () => {
  it("does not show onboarding to a registered account", () => {
    expect(shouldShowFirstRun(null, true)).toBe(false);
  });

  it("keeps the guest onboarding until its browser flag is retired", () => {
    expect(shouldShowFirstRun(null, false)).toBe(true);
    expect(shouldShowFirstRun(FIRST_RUN_DONE, false)).toBe(false);
  });
});

describe("nextFirstRunStep", () => {
  it("walks forward and then finishes", () => {
    expect(nextFirstRunStep(0, 3)).toBe(1);
    expect(nextFirstRunStep(1, 3)).toBe(2);
    expect(nextFirstRunStep(2, 3)).toBeNull();
  });

  it("clamps an index that has fallen off the array", () => {
    // A saved index outliving a released step is the realistic way this breaks.
    expect(nextFirstRunStep(-1, 3)).toBe(0);
    expect(nextFirstRunStep(1.5, 3)).toBe(0);
    expect(nextFirstRunStep(9, 3)).toBeNull();
  });

  it("finishes immediately when there are no steps at all", () => {
    expect(nextFirstRunStep(0, 0)).toBeNull();
    expect(nextFirstRunStep(-1, 0)).toBeNull();
  });
});

describe("firstRunProgressLabel", () => {
  it("counts from one, for a human", () => {
    expect(firstRunProgressLabel(0, 3)).toBe("1 of 3");
    expect(firstRunProgressLabel(2, 3)).toBe("3 of 3");
  });

  it("never prints an out-of-range position", () => {
    expect(firstRunProgressLabel(-4, 3)).toBe("1 of 3");
    expect(firstRunProgressLabel(40, 3)).toBe("3 of 3");
  });
});
