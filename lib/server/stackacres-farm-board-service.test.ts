import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { FARM_BOARD_POOL, farmBoardEntry, type FarmBoardFacts } from "@/lib/stackacres/farm-board";
import type { StoryEvent } from "@/lib/stackacres/story/events";
import { ensureProfile } from "./profile-store";
import { __resetStackAcresFarmBoardMemory } from "./stackacres-farm-board-store";
import {
  claimFarmBoardReward,
  farmBoardPeriods,
  farmBoardView,
  recordFarmBoardEvents,
} from "./stackacres-farm-board-service";
import { __resetStackAcresForTest, readStackAcresInfluence } from "./stackacres-store";

/**
 * Memory mode throughout: no Supabase env vars in the test run, so the
 * store's own mirror stands in for the tables and the grant Set stands in
 * for the ledger's primary key -- the same substitution every other store
 * test here makes.
 */

const EMPTY: FarmBoardFacts = { machines: [], hasCrops: false, hasLivestock: false };

/** A Monday, so the weekly period starts on the same date the day does. */
const MONDAY = new Date("2026-09-28T09:00:00.000Z");

async function newFarm(): Promise<{ token: string; profileId: string }> {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  return { token, profileId: profile.id };
}

async function gold(token: string): Promise<number> {
  return (await ensureProfile(token)).goldBalance;
}

const chopped = (count: number): StoryEvent => ({ kind: "wood-chopped", count });

/** Board a farm and answer with the code drawn into each slot. */
async function board(profileId: string, now: Date, facts: FarmBoardFacts = EMPTY) {
  const view = await farmBoardView(profileId, facts, now);
  return view.lines;
}

describe("the Daily Farm Board's periods", () => {
  it("uses the server's UTC day and UTC Monday, never a client clock", () => {
    const periods = farmBoardPeriods(new Date("2026-09-30T23:59:59.999Z"));
    expect(periods).toEqual([
      { kind: "daily", start: "2026-09-30", end: "2026-10-01T00:00:00.000Z" },
      { kind: "weekly", start: "2026-09-28", end: "2026-10-05T00:00:00.000Z" },
    ]);
  });

  it("rolls the day at UTC midnight and holds the week until Monday", () => {
    const before = farmBoardPeriods(new Date("2026-09-30T23:59:59.999Z"));
    const after = farmBoardPeriods(new Date("2026-10-01T00:00:00.000Z"));
    expect(after[0].start).toBe("2026-10-01");
    expect(after[0].start).not.toBe(before[0].start);
    // Same week: Wednesday's roll into Thursday does not move the Monday.
    expect(after[1].start).toBe(before[1].start);

    const nextWeek = farmBoardPeriods(new Date("2026-10-05T00:00:00.000Z"));
    expect(nextWeek[1].start).toBe("2026-10-05");
  });

  it("puts a Sunday in the week that started the Monday before it", () => {
    // The boundary ISO weeks get wrong when Sunday is treated as day 0.
    expect(farmBoardPeriods(new Date("2026-10-04T12:00:00.000Z"))[1].start).toBe("2026-09-28");
  });
});

describe("drawing a board for a farm", () => {
  beforeEach(() => {
    __resetStackAcresForTest();
    __resetStackAcresFarmBoardMemory();
  });

  it("draws three lines on the first read and never asks for locked content", async () => {
    const { profileId } = await newFarm();
    const lines = await board(profileId, MONDAY);
    expect(lines.map((line) => line.slot)).toEqual(["easy", "steady", "long"]);
    for (const line of lines) {
      // Nothing is built, so every drawn objective must need nothing built.
      expect(farmBoardEntry(line.code)?.needs.kind, line.code).toBe("none");
    }
  });

  it("hands back the same board on every later read of the same day", async () => {
    const { profileId } = await newFarm();
    const first = await board(profileId, MONDAY);
    const second = await board(profileId, new Date("2026-09-28T21:00:00.000Z"));
    expect(second.map((line) => line.code)).toEqual(first.map((line) => line.code));
  });

  it("keeps the board it drew even after the farm unlocks more", async () => {
    const { profileId } = await newFarm();
    const drawn = await board(profileId, MONDAY);
    // A Mill and an Oven go up at noon. The morning's board is the board.
    const later = await board(profileId, new Date("2026-09-28T12:00:00.000Z"), {
      machines: ["mill", "oven"],
      hasCrops: true,
      hasLivestock: true,
    });
    expect(later.map((line) => line.code)).toEqual(drawn.map((line) => line.code));
  });

  it("draws a new daily board tomorrow and keeps the weekly one", async () => {
    const { profileId } = await newFarm();
    const monday = await board(profileId, MONDAY);
    const tuesday = await board(profileId, new Date("2026-09-29T09:00:00.000Z"));
    const daily = (lines: typeof monday) => lines.filter((l) => l.slot !== "long").map((l) => l.code);
    const weekly = (lines: typeof monday) => lines.filter((l) => l.slot === "long").map((l) => l.code);
    expect(daily(tuesday)).not.toEqual(daily(monday));
    expect(weekly(tuesday)).toEqual(weekly(monday));
  });

  it("lets only one of two racing first reads draw the board", async () => {
    const { profileId } = await newFarm();
    const [a, b] = await Promise.all([board(profileId, MONDAY), board(profileId, MONDAY)]);
    expect(b.map((l) => l.code)).toEqual(a.map((l) => l.code));
  });
});

describe("progress", () => {
  beforeEach(() => {
    __resetStackAcresForTest();
    __resetStackAcresFarmBoardMemory();
  });

  it("shows progress as soon as the action lands", async () => {
    const { profileId } = await newFarm();
    const drawn = await board(profileId, MONDAY);
    const easy = drawn.find((line) => line.slot === "easy")!;
    await recordFarmBoardEvents(profileId, [eventFor(easy.code, 1)], MONDAY);
    const after = await board(profileId, MONDAY);
    expect(after.find((line) => line.code === easy.code)!.progress).toBeGreaterThan(0);
  });

  it("counts nothing for an action no line asked about", async () => {
    const { profileId } = await newFarm();
    await board(profileId, MONDAY);
    const before = await board(profileId, MONDAY);
    await recordFarmBoardEvents(profileId, [{ kind: "enchantment-forged" }], MONDAY);
    expect(await board(profileId, MONDAY)).toEqual(before);
  });

  it("moves no Gold, however much work lands on it", async () => {
    // The whole reason the reward is claimed rather than auto-credited: an
    // ordinary farm action must never move a purse (see advanceFarmBoard).
    const { profileId, token } = await newFarm();
    const drawn = await board(profileId, MONDAY);
    const before = await gold(token);
    for (const line of drawn) {
      await recordFarmBoardEvents(profileId, [eventFor(line.code, line.target * 3)], MONDAY);
    }
    expect(await gold(token)).toBe(before);
  });

  it("counts toward nothing before the day's first read, rather than throwing", async () => {
    const { profileId } = await newFarm();
    await recordFarmBoardEvents(profileId, [chopped(50)], MONDAY);
    for (const line of await board(profileId, MONDAY)) expect(line.progress).toBe(0);
  });

  it("does not carry yesterday's progress into today's board", async () => {
    const { profileId } = await newFarm();
    const drawn = await board(profileId, MONDAY);
    const easy = drawn.find((line) => line.slot === "easy")!;
    await recordFarmBoardEvents(profileId, [eventFor(easy.code, 2)], MONDAY);
    const tuesday = await board(profileId, new Date("2026-09-29T09:00:00.000Z"));
    for (const line of tuesday.filter((l) => l.slot !== "long")) expect(line.progress).toBe(0);
  });

  it("misses no day: a skipped day costs the next day's board nothing", async () => {
    const { profileId } = await newFarm();
    await board(profileId, MONDAY);
    const thursday = await board(profileId, new Date("2026-10-01T09:00:00.000Z"));
    expect(thursday.map((line) => line.slot)).toEqual(["easy", "steady", "long"]);
    for (const line of thursday.filter((l) => l.slot !== "long")) expect(line.progress).toBe(0);
  });
});

describe("claiming a reward", () => {
  beforeEach(() => {
    __resetStackAcresForTest();
    __resetStackAcresFarmBoardMemory();
  });

  /** A farm whose easy line is finished and waiting to be claimed. */
  async function finishedEasyLine() {
    const farm = await newFarm();
    const drawn = await board(farm.profileId, MONDAY);
    const easy = drawn.find((line) => line.slot === "easy")!;
    await recordFarmBoardEvents(farm.profileId, [eventFor(easy.code, easy.target)], MONDAY);
    return { ...farm, easy };
  }

  it("pays the line's Gold and Influence, once", async () => {
    const { profileId, token, easy } = await finishedEasyLine();
    const goldBefore = await gold(token);
    const influenceBefore = await readStackAcresInfluence(profileId);

    const claim = await claimFarmBoardReward(profileId, easy.code, MONDAY);
    expect(claim.ok).toBe(true);
    expect(await gold(token)).toBe(goldBefore + easy.goldReward);
    expect(await readStackAcresInfluence(profileId)).toBe(influenceBefore + easy.influenceReward);
  });

  it("refuses every later claim of the same line, and pays nothing more", async () => {
    const { profileId, token, easy } = await finishedEasyLine();
    await claimFarmBoardReward(profileId, easy.code, MONDAY);
    const paid = await gold(token);
    for (let i = 0; i < 4; i += 1) {
      const again = await claimFarmBoardReward(profileId, easy.code, MONDAY);
      expect(again).toEqual({ ok: false, reason: "already-claimed" });
    }
    expect(await gold(token)).toBe(paid);
  });

  it("pays only one of two claims racing the same line", async () => {
    const { profileId, token, easy } = await finishedEasyLine();
    const before = await gold(token);
    const both = await Promise.all([
      claimFarmBoardReward(profileId, easy.code, MONDAY),
      claimFarmBoardReward(profileId, easy.code, MONDAY),
    ]);
    expect(both.filter((claim) => claim.ok)).toHaveLength(1);
    expect(await gold(token)).toBe(before + easy.goldReward);
  });

  it("refuses an unfinished line without paying", async () => {
    const farm = await newFarm();
    const drawn = await board(farm.profileId, MONDAY);
    const before = await gold(farm.token);
    const claim = await claimFarmBoardReward(farm.profileId, drawn[0].code, MONDAY);
    expect(claim).toEqual({ ok: false, reason: "unfinished" });
    expect(await gold(farm.token)).toBe(before);
  });

  it("refuses a code that is not on this board, and one the pool never had", async () => {
    const farm = await newFarm();
    const drawn = await board(farm.profileId, MONDAY);
    const notDrawn = FARM_BOARD_POOL.find(
      (entry) => entry.slot === "easy" && !drawn.some((line) => line.code === entry.code),
    )!;
    expect(await claimFarmBoardReward(farm.profileId, notDrawn.code, MONDAY)).toEqual({
      ok: false,
      reason: "unknown",
    });
    expect(await claimFarmBoardReward(farm.profileId, "not_a_code", MONDAY)).toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("reads back as claimed, and stops offering the tap", async () => {
    const { profileId, easy } = await finishedEasyLine();
    await claimFarmBoardReward(profileId, easy.code, MONDAY);
    const line = (await board(profileId, MONDAY)).find((l) => l.code === easy.code)!;
    expect(line).toMatchObject({ complete: true, claimed: true, claimable: false });
  });

  it("will not pay yesterday's finished line today", async () => {
    const { profileId, easy } = await finishedEasyLine();
    // The day rolled over before the player came back to claim it. The
    // daily row for Tuesday is a different board, and it does not hold
    // Monday's code.
    const tuesday = new Date("2026-09-29T09:00:00.000Z");
    await board(profileId, tuesday);
    const claim = await claimFarmBoardReward(profileId, easy.code, tuesday);
    expect(claim.ok).toBe(false);
  });
});

/** The one event that advances `code`, at `count`. Mirrors the pool's own
 *  objective kinds; a new kind in the pool needs a case here. */
function eventFor(code: string, count: number): StoryEvent {
  const entry = farmBoardEntry(code);
  if (!entry) throw new Error(`no such board code: ${code}`);
  switch (entry.objective.kind) {
    case "chop":
      return { kind: "wood-chopped", count };
    case "mine":
      return { kind: "stone-mined", count };
    case "forage":
      return { kind: "forage-picked", count };
    case "fish":
      return { kind: "fish-caught", species: "bluegill" };
    case "reach-place":
      return { kind: "place-reached", placeId: entry.objective.place };
    case "harvest-any-crop":
      return { kind: "harvested", stock: "carrot", count };
    case "water":
      return { kind: "watered", count };
    case "feed":
      return { kind: "fed", count };
    case "collect-livestock":
      return { kind: "harvested", stock: "hen", count };
    case "process":
      return { kind: "processed", recipe: entry.objective.recipe, count };
    case "contracts":
      return { kind: "contract-fulfilled" };
    default:
      throw new Error(`no event mapped for ${entry.objective.kind}`);
  }
}
