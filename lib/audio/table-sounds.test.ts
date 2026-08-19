import { describe, expect, it } from "vitest";
import type { Card, GameSnapshot, LogEntry, PublicSeat, Rank, Suit } from "@/lib/game/types";
import { tableSounds } from "./table-sounds";

/**
 * Snapshots built by hand rather than driven through the engine.
 *
 * These tests are about which *changes* make which sounds, so the fixture has
 * to be able to express changes the engine would never produce in one step --
 * a version that goes backwards, a table swapped underneath the player -- and
 * to isolate one change at a time from the dozen a real hand makes at once.
 */
/** "Ah" -> the Card the engine would have produced. */
function card(text: string): Card {
  return { rank: text[0] as Rank, suit: text[1] as Suit };
}

function board(...cards: string[]): Card[] {
  return cards.map(card);
}

function logEntry(id: string, text: string): LogEntry {
  return { id, text, at: "2026-07-31T00:00:00.000Z", kind: "action" };
}

function seat(overrides: Partial<PublicSeat> & { id: string }): PublicSeat {
  return {
    name: overrides.id,
    initials: "XX",
    accent: "#fff",
    stack: 1000,
    streetBet: 0,
    status: "active",
    isCurrent: false,
    isMine: false,
    isHuman: true,
    isSmallBlind: false,
    isBigBlind: false,
    isDealer: false,
    holeCards: [],
    handLabel: null,
    lastAction: null,
    missedTurns: 0,
    timeCards: 0,
    avatarUrl: null,
    avatarCosmetic: null,
    ...overrides,
  } as PublicSeat;
}

function snapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    id: "table-1",
    version: 1,
    handNumber: 1,
    status: "playing",
    community: [],
    pot: 0,
    bigBlind: 10,
    log: [],
    seats: [seat({ id: "me", isMine: true }), seat({ id: "bot" })],
    ...overrides,
  } as GameSnapshot;
}

/** The same table one step later, so a test only states what it changed. */
function next(from: GameSnapshot, overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return { ...from, version: from.version + 1, ...overrides };
}

describe("tableSounds", () => {
  it("is silent when there is nothing to compare against", () => {
    expect(tableSounds(null, snapshot())).toEqual([]);
    expect(tableSounds(snapshot(), null)).toEqual([]);
  });

  it("is silent when the same version arrives twice", () => {
    // A realtime broadcast landing just behind the fetch that already applied
    // it. Without this the whole hand plays twice, one echo per event.
    const before = snapshot({ handNumber: 4 });
    expect(tableSounds(before, { ...before, handNumber: 5 })).toEqual([]);
  });

  it("is silent when the player has moved to a different table", () => {
    const before = snapshot({ id: "table-1", handNumber: 9 });
    const after = snapshot({ id: "table-2", version: 2, handNumber: 1 });
    expect(tableSounds(before, after)).toEqual([]);
  });

  it("deals, and lets the deal stand alone", () => {
    // A new hand resets streetBet and lastAction on every seat at once. If the
    // deal did not supersede the rest, that reset would read as five players
    // acting simultaneously.
    const before = snapshot({
      seats: [
        seat({ id: "me", isMine: true, streetBet: 40, lastAction: "Raise to · 40" }),
        seat({ id: "bot", streetBet: 40, lastAction: "Call · 40" }),
      ],
      community: board("Ah", "Kd", "2c"),
    });
    const after = next(before, {
      handNumber: 2,
      community: [],
      seats: [seat({ id: "me", isMine: true }), seat({ id: "bot" })],
    });
    expect(tableSounds(before, after)).toEqual(["deal"]);
  });

  it("marks the flop apart from the turn and the river", () => {
    const preflop = snapshot();
    const flop = next(preflop, { community: board("Ah", "Kd", "2c") });
    expect(tableSounds(preflop, flop)).toEqual(["flop"]);

    const turn = next(flop, { community: board("Ah", "Kd", "2c", "9s") });
    expect(tableSounds(flop, turn)).toEqual(["card"]);

    // Three cards arriving on a board that already had cards is a catch-up,
    // not a flop -- the moment has passed and the big sound would be a lie.
    const jump = next(flop, {
      community: board("Ah", "Kd", "2c", "9s", "3h"),
    });
    expect(tableSounds(flop, jump)).toEqual(["card"]);
  });

  it("plays another player's action, and the chips underneath it", () => {
    const before = snapshot();
    const after = next(before, {
      seats: [seat({ id: "me", isMine: true }), seat({ id: "bot", streetBet: 50, lastAction: "Raise to · 50" })],
    });
    expect(tableSounds(before, after)).toEqual(["chips", "raise"]);
  });

  it("stays quiet about the local player's own action", () => {
    // act() already played it optimistically on tap. Playing it again when the
    // server confirms is a stutter on every decision the player makes -- the
    // raise sound on tap, then a lone "chips" sound again once the snapshot
    // catches up, out of sync with each other.
    const before = snapshot();
    const after = next(before, {
      seats: [
        seat({ id: "me", isMine: true, streetBet: 50, lastAction: "Raise to · 50" }),
        seat({ id: "bot" }),
      ],
    });
    expect(tableSounds(before, after)).toEqual([]);
  });

  it("still sounds a posted blind for the local player, which has no seatSound of its own", () => {
    // A blind is posted automatically, not chosen -- act() never fires for
    // it, so the chip sound here is the only cue a stack just moved.
    const before = snapshot();
    const after = next(before, {
      seats: [
        seat({ id: "me", isMine: true, streetBet: 10, lastAction: "Big blind · 10" }),
        seat({ id: "bot" }),
      ],
    });
    expect(tableSounds(before, after)).toEqual(["chips"]);
  });

  it("plays one action even when several seats resolve at once", () => {
    // A catch-up advance settles every overdue turn in one response. Six folds
    // arriving together is a clatter, not a table.
    const before = snapshot({
      seats: [
        seat({ id: "me", isMine: true }),
        seat({ id: "a" }),
        seat({ id: "b" }),
        seat({ id: "c" }),
      ],
    });
    const after = next(before, {
      seats: [
        seat({ id: "me", isMine: true }),
        seat({ id: "a", lastAction: "Fold" }),
        seat({ id: "b", lastAction: "Fold" }),
        seat({ id: "c", lastAction: "Fold" }),
      ],
    });
    expect(tableSounds(before, after)).toEqual(["fold"]);
  });

  it("sounds the turn cue when the seat becomes yours, once", () => {
    const before = snapshot({
      seats: [seat({ id: "me", isMine: true }), seat({ id: "bot", isCurrent: true })],
    });
    const onMe = next(before, {
      seats: [seat({ id: "me", isMine: true, isCurrent: true }), seat({ id: "bot", lastAction: "Check" })],
    });
    expect(tableSounds(before, onMe)).toContain("your-turn");

    // Still my turn, and a snapshot arrives anyway -- a reconnect, another
    // seat's clock, a realtime echo one version later. Sounding the cue again
    // over the top of someone deciding is the failure this guards.
    const stillMe = next(onMe, { pot: 120 });
    expect(tableSounds(onMe, stillMe)).not.toContain("your-turn");
  });

  it("does not sound the turn cue for a seat that is not yours", () => {
    const before = snapshot();
    const after = next(before, {
      seats: [seat({ id: "me", isMine: true }), seat({ id: "bot", isCurrent: true })],
    });
    expect(tableSounds(before, after)).not.toContain("your-turn");
  });

  it("reacts once, for whoever won -- quietly for a routine pot", () => {
    const playing = snapshot({ pot: 200, bigBlind: 10 }); // 20bb, well under the huge-pot bar
    const complete = next(playing, { status: "complete" });
    expect(tableSounds(playing, complete)).toContain("win-modest");
    expect(tableSounds(playing, complete)).not.toContain("win");
    // The celebration holds for 2.8s while snapshots keep arriving.
    const stillComplete = next(complete, { pot: 0 });
    expect(tableSounds(complete, stillComplete)).not.toContain("win-modest");
  });

  it("reserves the crowd cheer for a genuinely huge pot", () => {
    // 100 big blinds -- a full starting stack, same at every tier.
    const playing = snapshot({ pot: 1000, bigBlind: 10 });
    const complete = next(playing, { status: "complete" });
    expect(tableSounds(playing, complete)).toContain("win");
    expect(tableSounds(playing, complete)).not.toContain("win-modest");
  });

  it("calls out a player who ran out of time, once per entry", () => {
    const before = snapshot({ log: [logEntry("1", "Hand 1 dealt")] });
    const after = next(before, {
      log: [logEntry("2", "bot ran out of time"), logEntry("1", "Hand 1 dealt")],
    });
    expect(tableSounds(before, after)).toContain("timeout");
    expect(tableSounds(after, next(after, { pot: 30 }))).not.toContain("timeout");
  });

  it("orders a busy snapshot as what happened, then whose turn, then the result", () => {
    const before = snapshot({
      seats: [seat({ id: "me", isMine: true }), seat({ id: "bot", isCurrent: true })],
    });
    const after = next(before, {
      community: board("Ah", "Kd", "2c"),
      seats: [
        seat({ id: "me", isMine: true, isCurrent: true }),
        seat({ id: "bot", streetBet: 50, lastAction: "Call · 50" }),
      ],
    });
    expect(tableSounds(before, after)).toEqual(["flop", "chips", "call", "your-turn"]);
  });
});
