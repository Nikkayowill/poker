import { describe, expect, it } from "vitest";
import {
  applyCribbageMove,
  createCribbageState,
  cribbageResult,
  cribbageSnapshot,
  resignCribbage,
  tickCribbage,
  WIN_SCORE,
  type CribbageState,
} from "./engine";
import { scoreHand } from "./scoring";
import type { Card, CribbageSeat, Rank } from "./types";

const T0 = 1_700_000_000_000;

function c(rank: Rank, suit: Card["suit"]): Card {
  return { rank, suit };
}

/** Applies a move expected to succeed, failing loudly if it was rejected. */
function play(state: CribbageState, seat: CribbageSeat, move: unknown, now = T0): CribbageState {
  const outcome = applyCribbageMove(state, seat, move, now);
  if (!("next" in outcome)) throw new Error(`Rejected: ${outcome.reject}`);
  return outcome.next;
}

/** Every seat discards its first card, in seat order. Discard order carries no rule. */
function discardAll(state: CribbageState): CribbageState {
  let next = state;
  for (let seat = 0; seat < state.playerCount; seat += 1) {
    next = play(next, seat, { type: "discard", card: next.hands[seat][0] });
  }
  return next;
}

/**
 * Plays the pegging phase to its natural end: whoever's turn it is plays the
 * lowest card that still fits under 31, or says go if none does. A generic,
 * legal-but-arbitrary strategy -- good enough to exercise the whole state
 * machine (turn order, go, 31, the automatic count) without hand-scripting
 * every play.
 */
function playOutPegging(state: CribbageState, now = T0): CribbageState {
  let next = state;
  let guard = 0;
  while (next.phase === "pegging") {
    guard += 1;
    if (guard > 500) throw new Error("Pegging did not conclude -- likely an infinite loop.");
    const seat = next.peggingTurn;
    if (seat === null) throw new Error("No seat to move in the pegging phase.");
    const hand = [...next.hands[seat]].sort((a, b) => a.rank - b.rank);
    const playable = hand.find((card) => Math.min(card.rank, 10) + next.peggingCount <= 31);
    next = playable
      ? play(next, seat, { type: "peg", card: playable }, now)
      : play(next, seat, { type: "go" }, now);
  }
  return next;
}

describe("createCribbageState", () => {
  it.each([3, 4] as const)("deals 5 cards to each of %i seats", (playerCount) => {
    const state = createCribbageState(20260819, T0, playerCount);
    expect(state.playerCount).toBe(playerCount);
    expect(state.phase).toBe("discard");
    expect(state.dealerSeat).toBe(0);
    expect(state.handNumber).toBe(0);
    expect(state.scores).toEqual(new Array(playerCount).fill(0));
    for (let seat = 0; seat < playerCount; seat += 1) expect(state.hands[seat]).toHaveLength(5);
    expect(state.deckRemaining).toHaveLength(52 - playerCount * 5);
  });

  it("rejects a player count that is not 3 or 4", () => {
    expect(() => createCribbageState(1, T0, 2)).toThrow();
    expect(() => createCribbageState(1, T0, 5)).toThrow();
  });
});

describe("discarding into the crib", () => {
  it("a 3-handed table burns one extra card so the crib is still exactly 4", () => {
    const dealt = createCribbageState(1, T0, 3);
    const pegging = discardAll(dealt);
    expect(pegging.phase).toBe("pegging");
    expect(pegging.crib).toHaveLength(4);
    expect(pegging.starter).not.toBeNull();
    for (let seat = 0; seat < 3; seat += 1) expect(pegging.originalHands[seat]).toHaveLength(4);
  });

  it("a 4-handed table needs no burn -- 4 discards of 1 already total 4", () => {
    const dealt = createCribbageState(2, T0, 4);
    const pegging = discardAll(dealt);
    expect(pegging.phase).toBe("pegging");
    expect(pegging.crib).toHaveLength(4);
    expect(pegging.starter).not.toBeNull();
  });

  it("rejects a card that is not in the discarder's hand", () => {
    const dealt = createCribbageState(3, T0, 3);
    const outcome = applyCribbageMove(dealt, 0, { type: "discard", card: { rank: 7, suit: "S" } }, T0);
    const heldSeven = dealt.hands[0].some((card) => card.rank === 7 && card.suit === "S");
    if (!heldSeven) expect(outcome).toHaveProperty("reject");
  });

  it("pegging leads from the seat left of the dealer, and the dealer pegs last", () => {
    const pegging = discardAll(createCribbageState(4, T0, 4));
    expect(pegging.peggingOrder).toEqual([1, 2, 3, 0]);
    expect(pegging.peggingTurn).toBe(1);
  });
});

/** A hand-built, fully valid state -- for exercising pegging/counting logic without fighting the shuffle. */
function craftedState(overrides: Partial<CribbageState>): CribbageState {
  const playerCount = overrides.playerCount ?? 3;
  const base: CribbageState = {
    playerCount,
    dealerSeat: 0,
    handNumber: 0,
    phase: "pegging",
    rngState: 12345,
    hands: Array.from({ length: playerCount }, () => []),
    originalHands: Array.from({ length: playerCount }, () => [c(2, "S"), c(3, "H"), c(4, "D"), c(9, "C")]),
    discarded: new Array(playerCount).fill(null),
    crib: [c(5, "S"), c(6, "H"), c(7, "D"), c(8, "C")],
    starter: c(9, "H"),
    deckRemaining: [],
    scores: new Array(playerCount).fill(0),
    peggingOrder: [1, 2, 0].slice(0, playerCount) as CribbageSeat[],
    peggingTurn: 1,
    peggingCount: 0,
    peggingPile: [],
    peggingLog: [],
    peggingGoneThisCycle: new Array(playerCount).fill(false),
    lastToPlaySeat: null,
    lastHandSummary: null,
    winner: null,
    winReason: null,
  };
  return { ...base, ...overrides };
}

describe("pegging turn order and go/31", () => {
  it("rotates through the pegging order and rejects an out-of-turn play", () => {
    const state = craftedState({
      hands: [[c(10, "S")], [c(2, "H")], [c(3, "D")]],
      peggingOrder: [1, 2, 0],
      peggingTurn: 1,
    });
    const outOfTurn = applyCribbageMove(state, 0, { type: "peg", card: c(10, "S") }, T0);
    expect(outOfTurn).toHaveProperty("reject");

    const afterFirst = play(state, 1, { type: "peg", card: c(2, "H") });
    expect(afterFirst.peggingTurn).toBe(2);
    expect(afterFirst.peggingCount).toBe(2);
  });

  it("does not reset while another seat can still play, even after a go", () => {
    // count is 29; seat 2 holds only a 5 (would break 31) and must say go --
    // but seat 0 still holds an ace that fits, so play must pass to them
    // with the count and pile untouched, not reset.
    const state = craftedState({
      hands: [[c(1, "S")], [], [c(5, "D")]],
      peggingOrder: [1, 2, 0],
      peggingTurn: 2,
      peggingCount: 29,
      peggingPile: [c(10, "H"), c(10, "D"), c(9, "S")],
      lastToPlaySeat: 1,
      scores: [0, 3, 0],
    });
    const rejectPlay = applyCribbageMove(state, 2, { type: "peg", card: c(5, "D") }, T0);
    expect(rejectPlay).toHaveProperty("reject");

    const afterGo = play(state, 2, { type: "go" });
    expect(afterGo.phase).toBe("pegging");
    expect(afterGo.peggingCount).toBe(29); // unchanged -- nobody has actually been stuck yet.
    expect(afterGo.peggingPile).toHaveLength(3);
    expect(afterGo.scores[1]).toBe(3); // no go point yet -- seat 0 hasn't had its turn.
    expect(afterGo.peggingTurn).toBe(0);
  });

  it("forces a go once EVERY remaining seat is stuck, and awards the point to the last player who could move", () => {
    // Only seat 2 still holds a card (a 5, which would break 31); seats 0
    // and 1 are already out of cards. Saying go here really does stall the
    // whole table, so it resets -- and the point goes to seat 1, who played
    // last, not to seat 2, who is merely passing.
    const state = craftedState({
      hands: [[], [], [c(5, "D")]],
      peggingOrder: [1, 2, 0],
      peggingTurn: 2,
      peggingCount: 29,
      peggingPile: [c(10, "H"), c(10, "D"), c(9, "S")],
      lastToPlaySeat: 1,
      scores: [0, 3, 0],
    });
    const afterGo = play(state, 2, { type: "go" });
    expect(afterGo.phase).toBe("pegging"); // seat 2 still holds the 5 -- pegging is not over.
    expect(afterGo.peggingCount).toBe(0);
    expect(afterGo.peggingPile).toEqual([]);
    expect(afterGo.scores[1]).toBe(4); // the go point, credited to seat 1, not seat 2.
    expect(afterGo.peggingTurn).toBe(2); // the reset clears "stuck", so seat 2 leads the fresh count.
  });

  it("31 resets the count immediately, even while another seat still holds a card that would have fit", () => {
    const state = craftedState({
      hands: [[c(1, "S")], [c(2, "H")], []],
      peggingOrder: [1, 2, 0],
      peggingTurn: 1,
      peggingCount: 29,
      peggingPile: [c(10, "S"), c(10, "H"), c(9, "D")],
      scores: [0, 0, 0],
    });
    const after = play(state, 1, { type: "peg", card: c(2, "H") });
    expect(after.phase).toBe("pegging"); // seat 0 still holds a card.
    expect(after.peggingCount).toBe(0); // reset immediately by the 31, not carried forward.
    expect(after.peggingPile).toEqual([]);
    expect(after.scores[1]).toBe(2); // the 31 bonus, not an extra go point on top.
    expect(after.peggingTurn).toBe(0);
  });

  it("a 4-seat go cascade credits the go point to whoever played last, then leads the fresh count with the next seat still holding cards", () => {
    // Seat 1 played last and is now out of cards; seats 2, 3 and 0 each hold
    // one card too big for the current count and cascade through "go" in
    // rotation order before the reset finally fires.
    const state = craftedState({
      playerCount: 4,
      dealerSeat: 0,
      hands: [[c(7, "S")], [], [c(8, "H")], [c(9, "D")]],
      peggingOrder: [1, 2, 3, 0],
      peggingTurn: 2,
      peggingCount: 25,
      peggingPile: [c(10, "S"), c(10, "H"), c(5, "D")],
      lastToPlaySeat: 1,
      scores: [0, 3, 0, 0],
    });

    const afterSeat2 = play(state, 2, { type: "go" });
    expect(afterSeat2.peggingCount).toBe(25); // seat 3 is still eligible -- no reset yet.
    expect(afterSeat2.peggingTurn).toBe(3);

    const afterSeat3 = play(afterSeat2, 3, { type: "go" });
    expect(afterSeat3.peggingCount).toBe(25); // seat 0 is still eligible.
    expect(afterSeat3.peggingTurn).toBe(0);

    const afterSeat0 = play(afterSeat3, 0, { type: "go" }); // nobody else can act -- full reset.
    expect(afterSeat0.phase).toBe("pegging"); // seats 0, 2 and 3 still hold cards.
    expect(afterSeat0.peggingCount).toBe(0);
    expect(afterSeat0.peggingPile).toEqual([]);
    expect(afterSeat0.scores[1]).toBe(4); // the go point -- seat 1 played last, even though seat 0 said the final go.
    expect(afterSeat0.peggingTurn).toBe(2); // the seat right after lastToPlaySeat (1) in rotation order, per the real rule.
  });
});

describe("the automatic count", () => {
  it("stops mid-count the instant a score crosses 121, without counting what comes after", () => {
    const hand = [c(2, "S"), c(3, "H"), c(4, "D"), c(13, "C")];
    const starter = c(12, "H");
    const expected = scoreHand(hand, starter, false);
    expect(expected.total).toBeGreaterThan(0);

    // One card left per seat, so the very next play empties every hand and
    // triggers the automatic count. Seat 1 counts first (left of the dealer)
    // and is pre-set close enough to WIN_SCORE that its own hand crosses it.
    const state = craftedState({
      dealerSeat: 0,
      hands: [[c(1, "S")], [c(1, "H")], [c(1, "D")]],
      originalHands: [
        [c(2, "H"), c(4, "H"), c(6, "H"), c(8, "H")],
        hand,
        [c(2, "D"), c(4, "D"), c(6, "D"), c(8, "D")],
      ],
      crib: [c(3, "S"), c(5, "S"), c(7, "S"), c(9, "S")],
      starter,
      peggingOrder: [1, 2, 0],
      peggingTurn: 1,
      scores: [0, WIN_SCORE - expected.total, 0],
    });

    const afterSeat1 = play(state, 1, { type: "peg", card: c(1, "H") });
    const afterSeat2 = play(afterSeat1, 2, { type: "peg", card: c(1, "D") });
    const final = play(afterSeat2, 0, { type: "peg", card: c(1, "S") });

    expect(final.phase).toBe("done");
    expect(final.winner).toBe(1);
    expect(final.scores[1]).toBe(WIN_SCORE);
    // Only seat 1's hand was counted -- seat 2, the dealer, and the crib
    // never got their turn, because the match was already over.
    expect(final.lastHandSummary?.entries).toHaveLength(1);
    expect(final.lastHandSummary?.entries[0].subject).toBe(1);
    expect(cribbageResult(final)).toEqual({ winner: 1, reason: "121" });
  });

  it("attaches a proper lastHandSummary when the match ends on heels alone, before any pegging or counting", () => {
    const state = craftedState({
      dealerSeat: 0,
      phase: "discard",
      hands: [[c(2, "S"), c(3, "S"), c(4, "S"), c(5, "S"), c(6, "S")], [], []],
      discarded: [null, c(9, "H"), c(9, "D")], // seats 1 and 2 already discarded
      deckRemaining: [c(2, "C"), c(11, "H")], // the 3-handed burn, then the starter -- a Jack
      scores: [WIN_SCORE - 2, 0, 0],
      handNumber: 4,
    });

    const outcome = applyCribbageMove(state, 0, { type: "discard", card: c(2, "S") }, T0);
    if (!("next" in outcome)) throw new Error(`Rejected: ${outcome.reject}`);
    const done = outcome.next;

    expect(done.phase).toBe("done");
    expect(done.winner).toBe(0);
    expect(done.scores[0]).toBe(WIN_SCORE);
    // Without this, a match ending right at the cut would still show
    // whatever hand the PREVIOUS deal happened to leave behind.
    expect(done.lastHandSummary?.handNumber).toBe(4);
    expect(done.lastHandSummary?.starter.rank).toBe(11);
    expect(done.lastHandSummary?.heelsPoints).toBe(2);
    expect(done.lastHandSummary?.entries).toEqual([]);
  });

  it("deals into the next hand, dealer rotated, when nobody has won yet", () => {
    const dealt = createCribbageState(555, T0, 3);
    const pegged = playOutPegging(discardAll(dealt));
    if (pegged.phase === "done") return; // a real deal occasionally decides it outright; nothing left to check.
    expect(pegged.phase).toBe("discard");
    expect(pegged.dealerSeat).toBe(1);
    expect(pegged.handNumber).toBe(1);
    for (let seat = 0; seat < 3; seat += 1) expect(pegged.hands[seat]).toHaveLength(5);
    expect(pegged.lastHandSummary).not.toBeNull();
  });
});

describe("tick", () => {
  it("always returns null -- cribbage has no real-time clock", () => {
    const live = discardAll(createCribbageState(9, T0, 3));
    expect(tickCribbage(live, T0 + 60_000)).toBeNull();
    const done = craftedState({ phase: "done", winner: 0, winReason: "121" });
    expect(tickCribbage(done, T0 + 60_000)).toBeNull();
  });
});

describe("resign", () => {
  it("ends the whole match immediately, paying the highest remaining score", () => {
    const state = craftedState({ playerCount: 4, scores: [10, 50, 30, 5], hands: Array.from({ length: 4 }, () => []) });
    const resigned = resignCribbage(state, 1, T0);
    expect(resigned.phase).toBe("done");
    expect(resigned.winner).toBe(2);
    expect(resigned.winReason).toBe("Resigned");
  });

  it("does nothing to an already-finished match", () => {
    const state = craftedState({ phase: "done", winner: 0, winReason: "121" });
    const resigned = resignCribbage(state, 1, T0);
    expect(resigned.winner).toBe(0);
    expect(resigned.winReason).toBe("121");
  });
});

describe("snapshot redaction", () => {
  it("shows the viewer their own hand and only card counts for everyone else", () => {
    const dealt = createCribbageState(42, T0, 3);
    const view = cribbageSnapshot(dealt, 0, T0);
    expect(view.yourHand).toEqual(dealt.hands[0]);
    expect(view.opponents).toHaveLength(2);
    for (const opponent of view.opponents) expect(opponent.cardsInHand).toBe(5);
  });

  it("a spectator (null seat) is the most restrictive view -- no own hand", () => {
    const dealt = createCribbageState(42, T0, 3);
    const view = cribbageSnapshot(dealt, null, T0);
    expect(view.yourHand).toEqual([]);
    expect(view.yourSeat).toBeNull();
    expect(view.opponents).toHaveLength(3);
  });

  it("treats a seat outside 0..playerCount-1 as an unknown viewer rather than crashing", () => {
    // Defense in depth: this should be unreachable once the table service
    // never seats a player it does not also build state for, but a wrong
    // seat here must degrade to the most-restrictive view, not throw.
    const dealt = createCribbageState(42, T0, 3);
    expect(() => cribbageSnapshot(dealt, 5, T0)).not.toThrow();
    const view = cribbageSnapshot(dealt, 5, T0);
    expect(view.yourHand).toEqual([]);
    expect(view.yourSeat).toBeNull();
    expect(view.opponents).toHaveLength(3);
  });
});

describe("a full match", () => {
  it("plays to a decisive winner without desyncing crib size, deck math, or turn order", () => {
    let state = createCribbageState(7, T0, 4);
    let hands = 0;
    while (state.phase !== "done") {
      hands += 1;
      if (hands > 200) throw new Error("Match did not conclude -- likely a state-machine bug.");
      state = playOutPegging(discardAll(state));
    }
    expect(cribbageResult(state)?.winner).toBe(state.winner);
    expect(state.scores[state.winner as number]).toBeGreaterThanOrEqual(WIN_SCORE);
  });
});
