import { describe, expect, it } from "vitest";
import {
  LIARS_DICE_STARTING_DICE,
  applyLiarsDiceMove,
  createLiarsDiceState,
  isLegalEscalation,
  liarsDiceResult,
  liarsDiceSnapshot,
  resignLiarsDice,
  type LiarsDiceState,
} from "./liars-dice";

function bid(count: number, faceValue: number) {
  return { type: "bid" as const, count, faceValue };
}

const challenge = { type: "challenge" as const };

describe("createLiarsDiceState", () => {
  it("is deterministic from its seed", () => {
    const a = createLiarsDiceState(42, 0);
    const b = createLiarsDiceState(42, 0);
    expect(a).toEqual(b);
  });

  it("deals five dice to each seat, faces 1-6", () => {
    const state = createLiarsDiceState(7, 0);
    expect(state.seats[0]).toHaveLength(LIARS_DICE_STARTING_DICE);
    expect(state.seats[1]).toHaveLength(LIARS_DICE_STARTING_DICE);
    for (const face of [...state.seats[0], ...state.seats[1]]) {
      expect(face).toBeGreaterThanOrEqual(1);
      expect(face).toBeLessThanOrEqual(6);
    }
  });

  it("starts with no bid, seat 0 to move", () => {
    const state = createLiarsDiceState(1, 0);
    expect(state.bid).toBeNull();
    expect(state.bidder).toBeNull();
    expect(state.turn).toBe(0);
    expect(state.outcome).toBeNull();
  });

  it("different seeds produce different hands", () => {
    const a = createLiarsDiceState(1, 0);
    const b = createLiarsDiceState(2, 0);
    expect(a.seats).not.toEqual(b.seats);
  });
});

describe("isLegalEscalation", () => {
  it("accepts any valid bid when there is nothing to escalate", () => {
    expect(isLegalEscalation({ count: 1, faceValue: 1 }, null)).toBe(true);
  });

  it("accepts a strictly higher count at any face", () => {
    expect(isLegalEscalation({ count: 4, faceValue: 1 }, { count: 3, faceValue: 6 })).toBe(true);
  });

  it("accepts the same count with a strictly higher face", () => {
    expect(isLegalEscalation({ count: 3, faceValue: 5 }, { count: 3, faceValue: 4 })).toBe(true);
  });

  it("rejects the same count with the same or a lower face", () => {
    expect(isLegalEscalation({ count: 3, faceValue: 4 }, { count: 3, faceValue: 4 })).toBe(false);
    expect(isLegalEscalation({ count: 3, faceValue: 3 }, { count: 3, faceValue: 4 })).toBe(false);
  });

  it("rejects a lower count regardless of face", () => {
    expect(isLegalEscalation({ count: 2, faceValue: 6 }, { count: 3, faceValue: 1 })).toBe(false);
  });
});

describe("applyLiarsDiceMove: bidding", () => {
  it("rejects a move from the seat not to move", () => {
    const state = createLiarsDiceState(1, 0);
    const result = applyLiarsDiceMove(state, 1, bid(1, 1), 0);
    expect(result).toEqual({ reject: "It is not your turn." });
  });

  it("rejects a malformed move payload", () => {
    const state = createLiarsDiceState(1, 0);
    expect(applyLiarsDiceMove(state, 0, null, 0)).toEqual({ reject: "That is not a move." });
    expect(applyLiarsDiceMove(state, 0, { type: "bid", count: "3", faceValue: 4 }, 0)).toEqual({
      reject: "That is not a move.",
    });
    expect(applyLiarsDiceMove(state, 0, { type: "bid", count: 3, faceValue: 7 }, 0)).toEqual({
      reject: "That is not a move.",
    });
    expect(applyLiarsDiceMove(state, 0, { type: "bid", count: 0, faceValue: 4 }, 0)).toEqual({
      reject: "That is not a move.",
    });
    expect(applyLiarsDiceMove(state, 0, { type: "spin" }, 0)).toEqual({ reject: "That is not a move." });
    expect(applyLiarsDiceMove(state, 0, "bid", 0)).toEqual({ reject: "That is not a move." });
  });

  it("rejects a bid claiming more dice than are on the table", () => {
    const state = createLiarsDiceState(1, 0);
    const result = applyLiarsDiceMove(state, 0, bid(11, 3), 0);
    expect(result).toEqual({ reject: "There aren't that many dice on the table." });
  });

  it("accepts a valid opening bid and hands the turn over", () => {
    const state = createLiarsDiceState(1, 0);
    const result = applyLiarsDiceMove(state, 0, bid(2, 3), 0);
    if (!("next" in result)) throw new Error("expected next");
    expect(result.next.bid).toEqual({ count: 2, faceValue: 3 });
    expect(result.next.bidder).toBe(0);
    expect(result.next.turn).toBe(1);
  });

  it("rejects a bid that fails to escalate", () => {
    const state = createLiarsDiceState(1, 0);
    const afterFirst = applyLiarsDiceMove(state, 0, bid(3, 4), 0);
    if (!("next" in afterFirst)) throw new Error("expected next");
    const result = applyLiarsDiceMove(afterFirst.next, 1, bid(3, 4), 0);
    expect(result).toEqual({
      reject: "A new bid has to raise the count, or match it and raise the face.",
    });
  });

  it("rejects any move once the match is over", () => {
    const state = createLiarsDiceState(1, 0);
    const over: LiarsDiceState = { ...state, outcome: { winner: 0, reason: "Out of dice" } };
    expect(applyLiarsDiceMove(over, 1, bid(1, 1), 0)).toEqual({
      reject: "This match is already over.",
    });
  });
});

describe("applyLiarsDiceMove: challenging", () => {
  it("rejects a challenge with no bid on the table", () => {
    const state = createLiarsDiceState(1, 0);
    const result = applyLiarsDiceMove(state, 0, challenge, 0);
    expect(result).toEqual({ reject: "There is no bid to challenge." });
  });

  it("costs the challenger a die when the true count meets the bid", () => {
    // Both hands all 6s: any bid on 6s of up to ten is true.
    const state: LiarsDiceState = {
      seats: [[6, 6, 6, 6, 6], [6, 6, 6, 6, 6]],
      bid: { count: 9, faceValue: 6 },
      bidder: 0,
      turn: 1,
      rngState: 123,
      lastReveal: null,
      outcome: null,
    };
    const result = applyLiarsDiceMove(state, 1, challenge, 0);
    if (!("next" in result)) throw new Error("expected next");
    expect(result.next.lastReveal?.loser).toBe(1);
    expect(result.next.lastReveal?.trueCount).toBe(10);
    // Challenger (seat 1) lost a die and re-rolled down to 4.
    expect(result.next.seats[1]).toHaveLength(4);
    expect(result.next.seats[0]).toHaveLength(5);
    // Loser of the round opens the next one.
    expect(result.next.turn).toBe(1);
    expect(result.next.bid).toBeNull();
  });

  it("costs the bidder a die when the true count falls short", () => {
    const state: LiarsDiceState = {
      seats: [[1, 2, 3, 4, 5], [1, 2, 3, 4, 5]],
      bid: { count: 9, faceValue: 6 },
      bidder: 0,
      turn: 1,
      rngState: 456,
      lastReveal: null,
      outcome: null,
    };
    const result = applyLiarsDiceMove(state, 1, challenge, 0);
    if (!("next" in result)) throw new Error("expected next");
    expect(result.next.lastReveal?.trueCount).toBe(0);
    expect(result.next.lastReveal?.loser).toBe(0);
    expect(result.next.seats[0]).toHaveLength(4);
    expect(result.next.turn).toBe(0);
  });

  it("ends the match when the loser has no dice left", () => {
    // Nobody has any 1s, so the bidder's claim of six 1s is false and the
    // bidder (seat 0, with only one die left) loses the match outright.
    const state: LiarsDiceState = {
      seats: [[6], [6, 6, 6, 6, 6]],
      bid: { count: 6, faceValue: 1 },
      bidder: 0,
      turn: 1,
      rngState: 789,
      lastReveal: null,
      outcome: null,
    };
    const result = applyLiarsDiceMove(state, 1, challenge, 0);
    if (!("next" in result)) throw new Error("expected next");
    expect(result.next.seats[0]).toHaveLength(0);
    expect(result.next.outcome).toEqual({ winner: 1, reason: "Out of dice" });
    expect(liarsDiceResult(result.next)).toEqual({ winner: 1, reason: "Out of dice" });
  });

  it("keeps dice counts to the total on the table across a reroll", () => {
    const state: LiarsDiceState = {
      seats: [[1, 2, 3, 4, 5], [6, 6, 6, 6, 6]],
      bid: { count: 1, faceValue: 6 },
      bidder: 1,
      turn: 0,
      rngState: 321,
      lastReveal: null,
      outcome: null,
    };
    const result = applyLiarsDiceMove(state, 0, challenge, 0);
    if (!("next" in result)) throw new Error("expected next");
    // True count of 6s is 5, which meets the bid of 1, so the challenger (seat 0) loses a die.
    expect(result.next.seats[0]).toHaveLength(4);
    expect(result.next.seats[1]).toHaveLength(5);
    for (const face of [...result.next.seats[0], ...result.next.seats[1]]) {
      expect(face).toBeGreaterThanOrEqual(1);
      expect(face).toBeLessThanOrEqual(6);
    }
  });
});

describe("resignLiarsDice", () => {
  it("is an immediate loss for the resigning seat", () => {
    const state = createLiarsDiceState(1, 0);
    const resigned = resignLiarsDice(state, 0, 0);
    expect(resigned.outcome).toEqual({ winner: 1, reason: "Resigned" });
  });

  it("leaves an already-finished match untouched", () => {
    const state = createLiarsDiceState(1, 0);
    const over: LiarsDiceState = { ...state, outcome: { winner: 0, reason: "Out of dice" } };
    const resigned = resignLiarsDice(over, 1, 0);
    expect(resigned).toEqual(over);
  });
});

describe("liarsDiceSnapshot", () => {
  it("shows a seat its own dice but not the opponent's, while live", () => {
    const state = createLiarsDiceState(9, 0);
    const view0 = liarsDiceSnapshot(state, 0, 0);
    expect(view0.seats[0].dice).toEqual(state.seats[0]);
    expect(view0.seats[1].dice).toBeNull();
    expect(view0.seats[1].diceCount).toBe(state.seats[1].length);

    const view1 = liarsDiceSnapshot(state, 1, 0);
    expect(view1.seats[1].dice).toEqual(state.seats[1]);
    expect(view1.seats[0].dice).toBeNull();
  });

  it("hides both hands from a spectator while live", () => {
    const state = createLiarsDiceState(9, 0);
    const spectator = liarsDiceSnapshot(state, null, 0);
    expect(spectator.seats[0].dice).toBeNull();
    expect(spectator.seats[1].dice).toBeNull();
  });

  it("reveals both hands once the match is over", () => {
    const state = createLiarsDiceState(9, 0);
    const over: LiarsDiceState = { ...state, outcome: { winner: 0, reason: "Out of dice" } };
    const view = liarsDiceSnapshot(over, 1, 0);
    expect(view.seats[0].dice).toEqual(state.seats[0]);
    expect(view.seats[1].dice).toEqual(state.seats[1]);
  });

  it("carries the last reveal forward even after fresh dice are hidden again", () => {
    const state: LiarsDiceState = {
      seats: [[6, 6, 6, 6, 6], [6, 6, 6, 6, 6]],
      bid: { count: 9, faceValue: 6 },
      bidder: 0,
      turn: 1,
      rngState: 123,
      lastReveal: null,
      outcome: null,
    };
    const result = applyLiarsDiceMove(state, 1, challenge, 0);
    if (!("next" in result)) throw new Error("expected next");
    const view = liarsDiceSnapshot(result.next, 0, 0);
    // The new round's dice are hidden from the non-owning seat again...
    expect(view.seats[1].dice).toBeNull();
    // ...but the reveal that just happened is still visible to both.
    expect(view.lastReveal?.trueCount).toBe(10);
    expect(view.lastReveal?.dice[1]).toEqual([6, 6, 6, 6, 6]);
  });

  it("keeps lastReveal through the next round's bids", () => {
    const state: LiarsDiceState = {
      seats: [[6, 6, 6, 6], [6, 6, 6, 6]],
      bid: null,
      bidder: null,
      turn: 1,
      rngState: 999,
      lastReveal: {
        dice: [[1, 2, 3, 4], [1, 2, 3, 4]],
        bid: { count: 1, faceValue: 5 },
        trueCount: 0,
        challenger: 0,
        loser: 1,
      },
      outcome: null,
    };
    const result = applyLiarsDiceMove(state, 1, bid(2, 2), 0);
    if (!("next" in result)) throw new Error("expected next");
    expect(result.next.lastReveal?.loser).toBe(1);
  });
});
