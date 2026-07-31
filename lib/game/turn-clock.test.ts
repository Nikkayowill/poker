import { describe, expect, it } from "vitest";
import { advanceRank, BACKUP_STAGGER_MS, planTurnClock, type TurnClockInput } from "./turn-clock";

const NOW = Date.parse("2026-07-28T12:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const input = (over: Partial<TurnClockInput> = {}): TurnClockInput => ({
  isSeated: true,
  turnDeadlineAt: at(2_000),
  nextHandAt: null,
  currentIsHuman: false,
  currentIsMine: false,
  myHumanRank: 0,
  ...over,
});

describe("the queue of browsers willing to advance", () => {
  it("puts nobody in the queue who is not seated", () => {
    expect(advanceRank(input({ isSeated: false }))).toBe(-1);
    expect(advanceRank(input({ myHumanRank: -1 }))).toBe(-1);
  });

  it("puts the player on the clock first when a human is thinking", () => {
    expect(advanceRank(input({ currentIsHuman: true, currentIsMine: true, myHumanRank: 3 }))).toBe(0);
    // Everyone else backs them up, behind their own seat order.
    expect(advanceRank(input({ currentIsHuman: true, currentIsMine: false, myHumanRank: 0 }))).toBe(1);
  });

  it("queues in seat order while a bot is thinking", () => {
    expect(advanceRank(input({ currentIsHuman: false, myHumanRank: 0 }))).toBe(0);
    expect(advanceRank(input({ currentIsHuman: false, myHumanRank: 2 }))).toBe(2);
  });

  it("gives every seated human a distinct place, so one absence cannot stall the table", () => {
    // The bug this replaces: a single elected leader. Three abandoned seats
    // ahead of a live player meant nobody advanced anything, ever.
    const ranks = [0, 1, 2, 3].map((r) => advanceRank(input({ currentIsHuman: false, myHumanRank: r })));
    expect(ranks).toEqual([0, 1, 2, 3]);
    expect(new Set(ranks).size).toBe(ranks.length);
  });
});

describe("when to ask the server to advance", () => {
  it("waits exactly until the deadline for the browser at the front", () => {
    const plan = planTurnClock(input({ turnDeadlineAt: at(1_800) }), NOW);
    expect(plan).toEqual({ kind: "advance-at", delayMs: 1_800, rank: 0 });
  });

  it("holds each backup a beat further back", () => {
    const second = planTurnClock(input({ turnDeadlineAt: at(1_800), myHumanRank: 1 }), NOW);
    const third = planTurnClock(input({ turnDeadlineAt: at(1_800), myHumanRank: 2 }), NOW);
    expect(second).toEqual({ kind: "advance-at", delayMs: 1_800 + BACKUP_STAGGER_MS, rank: 1 });
    expect(third).toEqual({ kind: "advance-at", delayMs: 1_800 + 2 * BACKUP_STAGGER_MS, rank: 2 });
    // The stagger has to outlast a round trip, or the backups fire before the
    // front browser's success can cancel them and we are back to a stampede.
    expect(BACKUP_STAGGER_MS).toBeGreaterThan(500);
  });

  it("goes immediately when the deadline has already passed", () => {
    // The old code floored this at 200ms, which is the retry storm: an
    // overdue deadline is still overdue 200ms later, so it rescheduled
    // forever. Zero means "once, now" -- the response then re-plans.
    const plan = planTurnClock(input({ turnDeadlineAt: at(-9_000) }), NOW);
    expect(plan).toEqual({ kind: "advance-at", delayMs: 0, rank: 0 });
  });

  it("does nothing at all without a deadline", () => {
    // A finished hand has no turn deadline. This is the state the table sits
    // in between hands, and it must generate no traffic whatsoever.
    expect(planTurnClock(input({ turnDeadlineAt: null }), NOW).kind).toBe("idle");
    expect(planTurnClock(input({ turnDeadlineAt: "not a date" }), NOW).kind).toBe("idle");
  });

  it("does nothing when you are not seated", () => {
    expect(planTurnClock(input({ isSeated: false }), NOW).kind).toBe("idle");
    expect(planTurnClock(input({ myHumanRank: -1 }), NOW).kind).toBe("idle");
  });

  it("never schedules repeat work for one deadline", () => {
    // Planning is a pure function of the snapshot: the same snapshot always
    // yields the same single wake-up, so a re-render cannot accumulate timers.
    const snapshot = input({ turnDeadlineAt: at(2_500) });
    const plans = [0, 1, 2, 3].map(() => planTurnClock(snapshot, NOW));
    expect(new Set(plans.map((p) => JSON.stringify(p))).size).toBe(1);
  });
});
