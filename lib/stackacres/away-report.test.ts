import { describe, expect, it } from "vitest";
import { AWAY_REPORT_MIN_MS, awayDurationLabel, buildAwayReport } from "./away-report";

const NOW = Date.parse("2026-09-28T12:00:00Z");
const HOUR = 3_600_000;
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const crop = (over: Partial<Parameters<typeof buildAwayReport>[0]["units"][number]> = {}) => ({
  stock: "wheat" as const,
  state: "ready" as const,
  readyAt: at(HOUR),
  hungryAt: null,
  thirstyAt: null,
  ...over,
});

const run = (over: Partial<Parameters<typeof buildAwayReport>[0]>) =>
  buildAwayReport({ units: [], machines: [], lastSeenMs: NOW - 5 * HOUR, nowMs: NOW, ...over });

describe("buildAwayReport", () => {
  it("says nothing when the player was only gone a moment", () => {
    expect(run({ lastSeenMs: NOW - AWAY_REPORT_MIN_MS + 1000, units: [crop()] })).toBeNull();
  });

  it("says nothing when nothing turned over", () => {
    expect(run({})).toBeNull();
  });

  it("tallies crops that ripened while away, biggest group first", () => {
    const report = run({
      units: [crop({ stock: "carrot" }), crop(), crop(), crop({ stock: "carrot" }), crop({ stock: "carrot" })],
    });
    expect(report?.lines).toEqual(["Ripe and ready to pick: 3 Carrot, 2 Wheat."]);
  });

  it("does not repeat a crop that was already ripe when the player last looked", () => {
    expect(run({ units: [crop({ readyAt: at(6 * HOUR) })] })).toBeNull();
  });

  it("separates animals from crops and reports hunger and thirst", () => {
    const report = run({
      units: [
        crop({ stock: "hen", readyAt: at(HOUR) }),
        crop({ stock: "hen", state: "hungry", readyAt: at(-HOUR), hungryAt: at(2 * HOUR) }),
        crop({ state: "dry", readyAt: at(-HOUR), thirstyAt: at(2 * HOUR) }),
      ],
    });
    expect(report?.lines).toEqual([
      "1 animal has something to collect.",
      "1 animal is hungry.",
      "Crops that dried out: 1 Wheat.",
    ]);
  });

  it("skips mucked units", () => {
    expect(run({ units: [crop({ state: "mucked" })] })).toBeNull();
  });

  it("reports a machine batch that finished while away, but not a running one", () => {
    const base = { kind: "mill" as const, standingRecipe: null, kitchenSince: null };
    const done = { ...base, status: "working" as const, recipeId: "flour" as const, readyAt: at(HOUR) };
    const running = { ...base, status: "working" as const, recipeId: "flour" as const, readyAt: at(-HOUR) };
    expect(run({ machines: [done] })?.lines).toEqual(["The Mill finished Flour."]);
    expect(run({ machines: [running] })).toBeNull();
  });

  it("reports the Farm Kitchen's banked batches", () => {
    const kitchen = {
      kind: "farm_kitchen" as const,
      status: "idle" as const,
      recipeId: null,
      readyAt: null,
      standingRecipe: "bread" as const,
      kitchenSince: at(2 * HOUR),
    };
    expect(run({ machines: [kitchen] })?.lines).toEqual(["The Farm Kitchen has 4 batches of Bread waiting."]);
  });
});

describe("awayDurationLabel", () => {
  it("reads in the largest sensible unit", () => {
    expect(awayDurationLabel(25 * 60_000)).toBe("25 minutes");
    expect(awayDurationLabel(HOUR)).toBe("1 hour");
    expect(awayDurationLabel(5 * HOUR)).toBe("5 hours");
    expect(awayDurationLabel(50 * HOUR)).toBe("2 days");
  });
});
