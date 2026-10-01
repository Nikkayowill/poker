import { describe, expect, it } from "vitest";
import {
  FARM_BOARD_MAX_GOLD,
  FARM_BOARD_POOL,
  FARM_BOARD_SLOTS,
  advanceFarmBoard,
  claimFarmBoard,
  drawFarmBoardCodes,
  drawFarmBoardSlot,
  eligibleFarmBoardEntries,
  farmBoardComplete,
  farmBoardEntry,
  farmBoardLines,
  freshFarmBoard,
  slotPeriodKind,
  type FarmBoardFacts,
} from "./farm-board";
import { RECIPE_CATALOGUE } from "./recipes";
import type { StoryEvent } from "./story/events";

/** A farm on its first morning: nothing built, nothing growing, no animals. */
const EMPTY: FarmBoardFacts = { machines: [], hasCrops: false, hasLivestock: false };
/** A farm a few chapters in. */
const WORKING: FarmBoardFacts = { machines: ["mill", "oven"], hasCrops: true, hasLivestock: true };

const DAY = "2026-09-30";
const WEEK = "2026-09-28";

describe("the farm board pool", () => {
  it("names a real recipe, and a real machine for it, in every requirement", () => {
    for (const entry of FARM_BOARD_POOL) {
      if (entry.needs.kind !== "recipe") continue;
      const def = RECIPE_CATALOGUE[entry.needs.recipe];
      expect(def, entry.code).toBeTruthy();
      expect(def.machine, entry.code).toBeTruthy();
    }
  });

  it("asks for a positive target and pays something in every entry", () => {
    for (const entry of FARM_BOARD_POOL) {
      expect(entry.objective.target, entry.code).toBeGreaterThan(0);
      expect(entry.goldReward, entry.code).toBeGreaterThan(0);
      expect(entry.influenceReward, entry.code).toBeGreaterThan(0);
    }
  });

  it("uses a unique code per entry, because the reward ledger is keyed on it", () => {
    const codes = FARM_BOARD_POOL.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("caps what a whole board can pay, and keeps it under one cheap town order", () => {
    // 1,140 Gold across a day and a week together. The cheapest Flour
    // contract pays 140 for one delivery; the point is that the board is a
    // nudge, not an income source (see the module header).
    expect(FARM_BOARD_MAX_GOLD).toBe(1_140);
    const worst = FARM_BOARD_SLOTS.map((slot) =>
      Math.max(...FARM_BOARD_POOL.filter((e) => e.slot === slot).map((e) => e.goldReward)),
    ).reduce((a, b) => a + b, 0);
    expect(worst).toBe(FARM_BOARD_MAX_GOLD);
  });

  it("pays the same Gold for every candidate in a slot, so no draw is a bad draw", () => {
    for (const slot of FARM_BOARD_SLOTS) {
      const rewards = new Set(FARM_BOARD_POOL.filter((e) => e.slot === slot).map((e) => e.goldReward));
      expect(rewards.size, slot).toBe(1);
    }
  });

  it("puts the long slot on the week and the other two on the day", () => {
    expect(slotPeriodKind("easy")).toBe("daily");
    expect(slotPeriodKind("steady")).toBe("daily");
    expect(slotPeriodKind("long")).toBe("weekly");
  });
});

describe("drawing a board", () => {
  it("never asks a farm for something it cannot do", () => {
    for (const entry of eligibleFarmBoardEntries(EMPTY)) {
      expect(entry.needs.kind, entry.code).toBe("none");
    }
    // The Dairy is not built, so nothing may ask for Cheese.
    const working = eligibleFarmBoardEntries(WORKING).map((e) => e.code);
    expect(working).not.toContain("steady_stew_1");
    expect(working).toContain("steady_flour_2");
    expect(working).toContain("steady_bread_1");
  });

  it("still fills all three slots on a farm with nothing built", () => {
    for (const slot of FARM_BOARD_SLOTS) {
      expect(drawFarmBoardSlot(slot, "profile-a", DAY, EMPTY), slot).not.toBeNull();
    }
    expect(drawFarmBoardCodes("daily", "profile-a", DAY, EMPTY)).toHaveLength(2);
    expect(drawFarmBoardCodes("weekly", "profile-a", WEEK, EMPTY)).toHaveLength(1);
  });

  it("is the same answer every time for one profile and one day", () => {
    const first = drawFarmBoardCodes("daily", "profile-a", DAY, WORKING);
    for (let i = 0; i < 20; i += 1) {
      expect(drawFarmBoardCodes("daily", "profile-a", DAY, WORKING)).toEqual(first);
    }
  });

  it("moves on to a different board tomorrow, and differs between players", () => {
    const today = drawFarmBoardCodes("daily", "profile-a", DAY, WORKING);
    const tomorrow = drawFarmBoardCodes("daily", "profile-a", "2026-10-01", WORKING);
    const other = drawFarmBoardCodes("daily", "profile-b", DAY, WORKING);
    expect(today).not.toEqual(tomorrow);
    expect(today).not.toEqual(other);
  });

  it("draws one objective per slot, in board order", () => {
    const codes = drawFarmBoardCodes("daily", "profile-c", DAY, WORKING);
    const slots = codes.map((code) => farmBoardEntry(code)?.slot);
    expect(slots).toEqual(["easy", "steady"]);
  });
});

describe("advancing a board", () => {
  const board = () => freshFarmBoard(["easy_chop_3", "steady_fish_3"]);
  const chopped = (count: number): StoryEvent => ({ kind: "wood-chopped", count });

  it("counts an event the instant it lands", () => {
    expect(advanceFarmBoard(board(), [chopped(2)]).counts).toEqual([2, 0]);
  });

  it("returns the same object when no line listened, so nothing is written", () => {
    const before = board();
    expect(advanceFarmBoard(before, [{ kind: "watered", count: 4 }])).toBe(before);
  });

  it("returns the same object for an empty batch", () => {
    const before = board();
    expect(advanceFarmBoard(before, [])).toBe(before);
  });

  it("never counts past the target", () => {
    expect(advanceFarmBoard(board(), [chopped(99)]).counts).toEqual([3, 0]);
  });

  it("stops moving a line that is already finished", () => {
    const finished = advanceFarmBoard(board(), [chopped(3)]);
    expect(advanceFarmBoard(finished, [chopped(3)])).toBe(finished);
  });

  it("moves no money at all -- a finished line only becomes claimable", () => {
    const finished = advanceFarmBoard(board(), [chopped(3)]);
    expect(finished.claimed).toEqual([]);
    expect(farmBoardLines(finished, "x")[0]).toMatchObject({ complete: true, claimable: true, claimed: false });
  });

  it("applies a whole batch at once, the way one harvest reports several stocks", () => {
    const next = advanceFarmBoard(freshFarmBoard(["easy_harvest_3"]), [
      { kind: "harvested", stock: "carrot", count: 1 },
      { kind: "harvested", stock: "potato", count: 1 },
    ]);
    expect(next.counts).toEqual([2]);
  });

  it("leaves a code the pool no longer has alone instead of throwing", () => {
    const stale = freshFarmBoard(["retired_last_deploy"]);
    expect(advanceFarmBoard(stale, [chopped(5)])).toBe(stale);
    expect(farmBoardLines(stale, "2026-10-01T00:00:00.000Z")).toEqual([]);
  });
});

describe("claiming a finished line", () => {
  const finished = () => advanceFarmBoard(freshFarmBoard(["easy_chop_3"]), [{ kind: "wood-chopped", count: 3 }]);

  it("refuses a line that is not finished, and touches nothing", () => {
    const fresh = freshFarmBoard(["easy_chop_3"]);
    const claim = claimFarmBoard(fresh, "easy_chop_3");
    expect(claim).toEqual({ ok: false, refusal: "unfinished" });
  });

  it("refuses a code this board does not hold", () => {
    expect(claimFarmBoard(finished(), "steady_fish_3")).toEqual({ ok: false, refusal: "unknown" });
    expect(claimFarmBoard(finished(), "not_a_code")).toEqual({ ok: false, refusal: "unknown" });
  });

  it("hands back the row to write, and the entry to pay", () => {
    const claim = claimFarmBoard(finished(), "easy_chop_3");
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.board.claimed).toEqual(["easy_chop_3"]);
    expect(claim.entry.goldReward).toBeGreaterThan(0);
  });

  it("refuses a second claim of the same line", () => {
    const claim = claimFarmBoard(finished(), "easy_chop_3");
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claimFarmBoard(claim.board, "easy_chop_3")).toEqual({ ok: false, refusal: "already-claimed" });
  });

  it("reads as claimed, not claimable, once taken", () => {
    const claim = claimFarmBoard(finished(), "easy_chop_3");
    if (!claim.ok) throw new Error("expected a claim");
    expect(farmBoardLines(claim.board, "x")[0]).toMatchObject({
      complete: true,
      claimed: true,
      claimable: false,
    });
  });
});

describe("the board a player sees", () => {
  it("labels each line with the travelers' own wording and carries the period end", () => {
    const board = freshFarmBoard(["easy_chop_3", "steady_fish_3"]);
    const lines = farmBoardLines(board, "2026-10-01T00:00:00.000Z");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      code: "easy_chop_3",
      slot: "easy",
      label: "Chop 3 Wood",
      progress: 0,
      target: 3,
      complete: false,
      claimed: false,
      claimable: false,
      periodEnd: "2026-10-01T00:00:00.000Z",
    });
    expect(lines[1].label).toBe("Catch 3 fish");
  });

  it("reads a finished line as complete", () => {
    const entry = farmBoardEntry("easy_chop_3");
    expect(entry).not.toBeNull();
    expect(farmBoardComplete(entry!, 3)).toBe(true);
    expect(farmBoardComplete(entry!, 2)).toBe(false);
  });

  it("clamps a count stored before a target was retuned downward", () => {
    const board = { codes: ["easy_chop_3"], counts: [99], claimed: [] };
    expect(farmBoardLines(board, "x")[0].progress).toBe(3);
  });
});
