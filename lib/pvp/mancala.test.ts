import { describe, expect, it } from "vitest";
import {
  MANCALA_CLOCK_MS,
  MANCALA_DUEL,
  MANCALA_INCREMENT_MS,
  PIT_COUNT,
  STORE_SEAT0,
  STORE_SEAT1,
  applyMancalaMove,
  createMancalaState,
  legalMancalaPits,
  mancalaRemainingMs,
  mancalaResult,
  mancalaSnapshot,
  openingPits,
  oppositePit,
  resignMancala,
  seatPits,
  tickMancala,
  type MancalaState,
} from "./mancala";
import type { DuelSeat } from "./match-contract";

const T0 = 1_000_000;

function stateWith(pits: number[], extra: Partial<MancalaState> = {}): MancalaState {
  return { ...createMancalaState(0, T0), pits, ...extra };
}

/** Plays a move that must be legal, and hands back the next state. */
function play(state: MancalaState, seat: DuelSeat, pit: number, now = T0): MancalaState {
  const result = applyMancalaMove(state, seat, { pit }, now);
  if (!("next" in result)) throw new Error(`rejected: ${result.reject}`);
  return result.next;
}

describe("the opening position", () => {
  it("has four seeds in every playing pit and empty stores", () => {
    const pits = openingPits();
    expect(pits).toHaveLength(PIT_COUNT);
    for (const pit of seatPits(0)) expect(pits[pit]).toBe(4);
    for (const pit of seatPits(1)) expect(pits[pit]).toBe(4);
    expect(pits[STORE_SEAT0]).toBe(0);
    expect(pits[STORE_SEAT1]).toBe(0);
  });

  it("starts with seat 0 to move and no outcome", () => {
    const state = createMancalaState(0, T0);
    expect(state.turn).toBe(0);
    expect(state.outcome).toBeNull();
  });
});

describe("opposite pits", () => {
  it("mirrors across the middle of the board", () => {
    expect(oppositePit(0)).toBe(12);
    expect(oppositePit(5)).toBe(7);
    expect(oppositePit(7)).toBe(5);
    expect(oppositePit(12)).toBe(0);
  });
});

describe("legal pits", () => {
  it("is a seat's own non-empty playing pits", () => {
    const pits = openingPits();
    pits[2] = 0;
    expect(legalMancalaPits(pits, 0)).toEqual([0, 1, 3, 4, 5]);
    expect(legalMancalaPits(pits, 1)).toEqual([7, 8, 9, 10, 11, 12]);
  });
});

describe("sowing", () => {
  it("drops one seed in each of the next pits, wrapping the board", () => {
    const state = createMancalaState(0, T0);
    const next = play(state, 0, 0);
    // Pit 0 held 4 seeds: pits 1, 2, 3, 4 each gain one.
    expect(next.pits[0]).toBe(0);
    expect(next.pits[1]).toBe(5);
    expect(next.pits[2]).toBe(5);
    expect(next.pits[3]).toBe(5);
    expect(next.pits[4]).toBe(5);
    expect(next.pits[5]).toBe(4);
  });

  it("skips the opponent's store but fills the mover's own", () => {
    // Pit 0 starts pre-seeded so landing there does not also read as an
    // empty-pit capture; this test is only about which pits get skipped.
    const state = stateWith([1, 0, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0]);
    const next = play(state, 0, 5);
    // 8 seeds from pit 5: store(6), 7, 8, 9, 10, 11, 12, skip store(13), then 0.
    expect(next.pits[STORE_SEAT0]).toBe(1);
    expect(next.pits[7]).toBe(1);
    expect(next.pits[12]).toBe(1);
    expect(next.pits[STORE_SEAT1]).toBe(0);
    expect(next.pits[0]).toBe(2);
  });

  it("laps the board more than once for a very large pit", () => {
    // 20 seeds from pit 0 laps past pit 13's neighborhood more than once,
    // landing back on an already-visited pit; the last one should still
    // land somewhere sensible and the total seed count must be conserved.
    const pits = new Array(PIT_COUNT).fill(0);
    pits[0] = 20;
    const state = stateWith(pits);
    const next = play(state, 0, 0);
    const total = next.pits.reduce((sum, count) => sum + count, 0);
    expect(total).toBe(20);
  });
});

describe("the extra turn rule", () => {
  it("keeps the same seat's turn when the last seed lands in their own store", () => {
    // Pit 5 has exactly one seed: it lands in seat 0's store and nowhere else.
    const pits = openingPits();
    pits[5] = 1;
    const state = stateWith(pits);
    const next = play(state, 0, 5);
    expect(next.turn).toBe(0);
  });

  it("passes the turn when the last seed lands anywhere else", () => {
    const state = createMancalaState(0, T0);
    const next = play(state, 0, 0);
    expect(next.turn).toBe(1);
  });
});

describe("the last move record", () => {
  it("is null before anyone has moved", () => {
    expect(createMancalaState(0, T0).lastMove).toBeNull();
  });

  it("records an extra turn", () => {
    const pits = openingPits();
    pits[5] = 1;
    const next = play(stateWith(pits), 0, 5);
    expect(next.lastMove).toEqual({ seat: 0, pit: 5, lastPit: STORE_SEAT0, captured: 0, extraTurn: true });
  });

  it("records a capture, and reaches the snapshot", () => {
    const pits = openingPits();
    pits[1] = 1;
    pits[2] = 0;
    pits[10] = 5;
    const next = play(stateWith(pits), 0, 1);
    expect(next.lastMove).toEqual({ seat: 0, pit: 1, lastPit: 2, captured: 6, extraTurn: false });
    expect(mancalaSnapshot(next, 1, T0).lastMove).toEqual(next.lastMove);
  });

  it("does not claim an extra turn on a move that ends the game", () => {
    const pits = new Array<number>(PIT_COUNT).fill(0);
    pits[5] = 1;
    pits[7] = 3;
    const next = play(stateWith(pits), 0, 5);
    expect(next.outcome).not.toBeNull();
    expect(next.lastMove?.extraTurn).toBe(false);
  });
});

describe("the capture rule", () => {
  it("sweeps the landing pit and the opposite pit into the mover's store", () => {
    // Pit 2 is empty; pit 1 has one seed, which lands in pit 2 (empty on
    // seat 0's own side). Pit 10, opposite pit 2, holds seeds to capture.
    const pits = openingPits();
    pits[1] = 1;
    pits[2] = 0;
    pits[10] = 5;
    const state = stateWith(pits);
    const next = play(state, 0, 1);
    expect(next.pits[2]).toBe(0);
    expect(next.pits[10]).toBe(0);
    expect(next.pits[STORE_SEAT0]).toBe(6);
  });

  it("does not capture when the opposite pit is empty", () => {
    const pits = openingPits();
    pits[1] = 1;
    pits[2] = 0;
    pits[10] = 0;
    const state = stateWith(pits);
    const next = play(state, 0, 1);
    expect(next.pits[2]).toBe(1);
    expect(next.pits[STORE_SEAT0]).toBe(0);
  });

  it("does not capture when the landing pit is on the opponent's side", () => {
    // Pit 5 has two seeds: they land in seat 0's store, then pit 7 (seat
    // 1's row) -- the store move earns a repeat but the final landing here
    // is a store, not an opponent pit, so this only exercises "own side" by
    // using a case that lands in the opponent's row instead.
    const pits = openingPits();
    pits[5] = 2;
    pits[7] = 0;
    const state = stateWith(pits);
    const next = play(state, 0, 5);
    // Last seed lands in pit 7, which belongs to seat 1, not the mover: no capture.
    expect(next.pits[7]).toBe(1);
    expect(next.pits[STORE_SEAT0]).toBe(1);
  });

  it("does not capture when the landing pit already had seeds", () => {
    const pits = openingPits();
    pits[1] = 1;
    // Pit 2 already has seeds, so landing there does not count as "empty before".
    const state = stateWith(pits);
    const next = play(state, 0, 1);
    expect(next.pits[2]).toBe(5);
    expect(next.pits[STORE_SEAT0]).toBe(0);
  });
});

describe("ending the game", () => {
  it("sweeps the side still holding seeds into their own store when the other empties", () => {
    // Seat 0 has one seed left in pit 5, which empties their row when played
    // (it lands in their own store, not back on their own side).
    const pits = new Array(PIT_COUNT).fill(0);
    pits[5] = 1;
    pits[7] = 3;
    pits[10] = 4;
    const state = stateWith(pits);
    const next = play(state, 0, 5);
    expect(next.outcome).not.toBeNull();
    for (const pit of seatPits(0)) expect(next.pits[pit]).toBe(0);
    for (const pit of seatPits(1)) expect(next.pits[pit]).toBe(0);
    // Seat 1 still had 7 seeds on their side; those are swept into their store.
    expect(next.pits[STORE_SEAT1]).toBe(7);
    expect(next.pits[STORE_SEAT0]).toBe(1);
    expect(next.outcome).toEqual({ winner: 1, reason: "7 - 1" });
  });

  it("calls it a draw when both stores end level", () => {
    const pits = new Array(PIT_COUNT).fill(0);
    pits[5] = 1;
    pits[STORE_SEAT0] = 1;
    pits[7] = 2;
    const state = stateWith(pits);
    const next = play(state, 0, 5);
    expect(next.outcome).toEqual({ winner: null, reason: "2 - 2" });
  });

  it("rejects any further move once the match is over", () => {
    const state = stateWith(openingPits(), {
      outcome: { winner: 0, reason: "10 - 0" },
    });
    const result = applyMancalaMove(state, 1, { pit: 7 }, T0);
    expect(result).toEqual({ reject: "This match is already over." });
  });
});

describe("rejected moves", () => {
  const state = createMancalaState(0, T0);

  it("rejects a malformed payload", () => {
    expect(applyMancalaMove(state, 0, null, T0)).toEqual({ reject: "That is not a move." });
    expect(applyMancalaMove(state, 0, { pit: "3" }, T0)).toEqual({ reject: "That is not a move." });
    expect(applyMancalaMove(state, 0, { pit: 1.5 }, T0)).toEqual({ reject: "That is not a move." });
  });

  it("rejects a move from the seat not to move", () => {
    expect(applyMancalaMove(state, 1, { pit: 7 }, T0)).toEqual({ reject: "It is not your turn." });
  });

  it("rejects a pit that belongs to the other seat", () => {
    expect(applyMancalaMove(state, 0, { pit: 7 }, T0)).toEqual({
      reject: "That is not one of your pits.",
    });
  });

  it("rejects a store as a chosen pit", () => {
    expect(applyMancalaMove(state, 0, { pit: STORE_SEAT0 }, T0)).toEqual({
      reject: "That is not one of your pits.",
    });
  });

  it("rejects an empty pit", () => {
    const pits = openingPits();
    pits[0] = 0;
    const empty = stateWith(pits);
    expect(applyMancalaMove(empty, 0, { pit: 0 }, T0)).toEqual({ reject: "That pit is empty." });
  });

  it("rejects a pit index out of range", () => {
    expect(applyMancalaMove(state, 0, { pit: 14 }, T0)).toEqual({ reject: "That is not a move." });
    expect(applyMancalaMove(state, 0, { pit: -1 }, T0)).toEqual({ reject: "That is not a move." });
  });
});

describe("resigning", () => {
  it("is an immediate loss for the resigning seat", () => {
    const state = createMancalaState(0, T0);
    const next = resignMancala(state, 0, T0);
    expect(next.outcome).toEqual({ winner: 1, reason: "Resigned" });
  });

  it("does nothing to an already-finished match", () => {
    const state = stateWith(openingPits(), { outcome: { winner: 0, reason: "9 - 3" } });
    const next = resignMancala(state, 1, T0);
    expect(next.outcome).toEqual({ winner: 0, reason: "9 - 3" });
  });
});

describe("mancalaResult", () => {
  it("is null while the match is live", () => {
    expect(mancalaResult(createMancalaState(0, T0))).toBeNull();
  });

  it("is the recorded outcome once the match is over", () => {
    const state = stateWith(openingPits(), { outcome: { winner: 1, reason: "5 - 3" } });
    expect(mancalaResult(state)).toEqual({ winner: 1, reason: "5 - 3" });
  });
});

describe("mancalaSnapshot", () => {
  it("shows the full board to both seats, since Mancala hides nothing", () => {
    const state = createMancalaState(0, T0);
    const forSeat0 = mancalaSnapshot(state, 0, T0);
    const forSeat1 = mancalaSnapshot(state, 1, T0);
    expect(forSeat0.pits).toEqual(state.pits);
    expect(forSeat1.pits).toEqual(state.pits);
    expect(forSeat0.stores).toEqual([0, 0]);
  });

  it("only lists legal pits for the seat actually to move", () => {
    const state = createMancalaState(0, T0);
    expect(mancalaSnapshot(state, 0, T0).legalPits).toEqual([0, 1, 2, 3, 4, 5]);
    expect(mancalaSnapshot(state, 1, T0).legalPits).toEqual([]);
    expect(mancalaSnapshot(state, null, T0).legalPits).toEqual([]);
  });

  it("lists no legal pits once the match is over", () => {
    const state = stateWith(openingPits(), { outcome: { winner: 0, reason: "9 - 3" } });
    expect(mancalaSnapshot(state, 0, T0).legalPits).toEqual([]);
  });
});

describe("MANCALA_DUEL", () => {
  it("registers under the id \"mancala\"", () => {
    expect(MANCALA_DUEL.id).toBe("mancala");
  });

  it("plays a full move through the registered duel object", () => {
    const state = MANCALA_DUEL.createState(0, T0) as MancalaState;
    const result = MANCALA_DUEL.applyMove(state, 0, { pit: 0 }, T0);
    expect("next" in result).toBe(true);
  });
});

describe("the clock", () => {
  it("only runs for the seat to move", () => {
    const state = createMancalaState(0, T0);
    expect(mancalaRemainingMs(state, 0, T0 + 10_000)).toBe(MANCALA_CLOCK_MS - 10_000);
    expect(mancalaRemainingMs(state, 1, T0 + 10_000)).toBe(MANCALA_CLOCK_MS);
  });

  it("banks the mover's time plus the increment and starts the next turn", () => {
    const next = play(createMancalaState(0, T0), 0, 0, T0 + 20_000);
    expect(next.clocks[0]).toBe(MANCALA_CLOCK_MS - 20_000 + MANCALA_INCREMENT_MS);
    expect(next.turnStartedAt).toBe(T0 + 20_000);
  });

  it("does nothing on a tick while time remains", () => {
    expect(tickMancala(createMancalaState(0, T0), T0 + 60_000)).toBeNull();
  });

  it("forfeits a staller whose flag falls, with the board left as it was", () => {
    const state = play(createMancalaState(0, T0), 0, 0, T0);
    expect(state.turn).toBe(1);
    const ticked = tickMancala(state, T0 + MANCALA_CLOCK_MS);
    expect(ticked?.outcome).toEqual({ winner: 0, reason: "Timeout" });
    expect(ticked?.pits).toEqual(state.pits);
    expect(MANCALA_DUEL.tick?.(state, T0 + MANCALA_CLOCK_MS)).toEqual(ticked);
  });

  it("ends the match when a flagged player tries to move", () => {
    const result = applyMancalaMove(createMancalaState(0, T0), 0, { pit: 0 }, T0 + MANCALA_CLOCK_MS + 1);
    if (!("next" in result)) throw new Error("expected next");
    expect(result.next.outcome).toEqual({ winner: 1, reason: "Timeout" });
  });

  it("gives a match stored before the clock a full clock once, then leaves it alone", () => {
    const legacy = { pits: openingPits(), turn: 1, lastMove: null, outcome: null } as unknown as MancalaState;
    const first = tickMancala(legacy, T0);
    expect(first?.clocks).toEqual([MANCALA_CLOCK_MS, MANCALA_CLOCK_MS]);
    expect(first && tickMancala(first, T0 + 1_000)).toBeNull();
    expect(mancalaSnapshot(legacy, 1, T0).clocks).toEqual([MANCALA_CLOCK_MS, MANCALA_CLOCK_MS]);
    expect(play(legacy, 1, 7).turn).toBe(0);
  });

  it("shows live clocks in the snapshot and freezes them on resign", () => {
    const state = createMancalaState(0, T0);
    expect(mancalaSnapshot(state, 1, T0 + 5_000).clocks).toEqual([MANCALA_CLOCK_MS - 5_000, MANCALA_CLOCK_MS]);
    const resigned = resignMancala(state, 1, T0 + 5_000);
    expect(mancalaSnapshot(resigned, 1, T0 + 60_000).clocks).toEqual([MANCALA_CLOCK_MS - 5_000, MANCALA_CLOCK_MS]);
  });
});
