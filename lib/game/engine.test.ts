import { describe, expect, it } from "vitest";
import { applyPlayerAction, claimSeat, createGame, expireIdleTurn, TURN_TIMEOUT_MS, toSnapshot, vacateSeat } from "./engine";
import { evaluateHand } from "./evaluator";
import type { Card, PlayerAction } from "./types";
import type { PlayerProfile } from "@/lib/profile/types";

const testProfile = (name: string): Pick<PlayerProfile, "displayName" | "initials" | "accent" | "avatarUrl" | "avatarPreset"> => ({
  displayName: name,
  initials: name.slice(0, 2).toUpperCase(),
  accent: "#79c9ff",
  avatarUrl: null,
  avatarPreset: "ace",
});

const cards = (values: string): Card[] =>
  values.split(" ").map((value) => {
    const suitMap = { c: "clubs", d: "diamonds", h: "hearts", s: "spades" } as const;
    return {
      rank: value.slice(0, -1) as Card["rank"],
      suit: suitMap[value.at(-1)! as keyof typeof suitMap],
    };
  });

describe("hand evaluator", () => {
  it("recognizes a royal straight flush", () => {
    const score = evaluateHand(cards("As Ks Qs Js 10s 2d 3c"));
    expect(score.name).toBe("Straight flush");
    expect(score.values).toEqual([8, 14]);
  });

  it("uses a wheel ace as the low end of a straight", () => {
    const score = evaluateHand(cards("As 2d 3h 4c 5s Kd Qc"));
    expect(score.name).toBe("Straight");
    expect(score.values).toEqual([4, 5]);
  });

  it("prefers a full house over a flush", () => {
    const fullHouse = evaluateHand(cards("Ah Ad Ac Ks Kd 2h 3h"));
    const flush = evaluateHand(cards("Ah Jh 8h 5h 2h Kd Qc"));
    expect(fullHouse.values[0]).toBeGreaterThan(flush.values[0]);
  });
});

describe("server game engine", () => {
  it("never exposes the deck or opponents' hole cards", () => {
    const token = crypto.randomUUID();
    const game = createGame(token, "Test");
    const snapshot = toSnapshot(game, token);
    expect("deck" in snapshot).toBe(false);
    expect(snapshot.seats[0].holeCards.every(Boolean)).toBe(true);
    expect(snapshot.seats.slice(1).flatMap((seat) => seat.holeCards).every((card) => card === null)).toBe(true);
  });

  it("plays repeated complete hands while conserving chips", () => {
    const token = crypto.randomUUID();
    let game = createGame(token, "Test");
    let completed = 0;
    let safety = 0;

    while (completed < 12) {
      if (game.status === "complete") {
        expect(game.seats.reduce((sum, seat) => sum + seat.stack, 0)).toBe(4000);
        completed += 1;
        if (completed >= 12 || game.seats[0].stack === 0) break;
        game = applyPlayerAction(game, { type: "next-hand" }, token);
      } else {
        const legal = toSnapshot(game, token).legalActions;
        expect(legal).not.toBeNull();
        let action: PlayerAction;
        if (legal!.canCheck) action = { type: "check" };
        else if (legal!.canCall) action = { type: "call" };
        else action = { type: "all-in" };
        game = applyPlayerAction(game, action, token);
        if (game.status === "playing") {
          expect(game.seats.reduce((sum, seat) => sum + seat.stack, 0) + game.pot).toBe(4000);
        }
      }
      safety += 1;
      expect(safety).toBeLessThan(500);
    }
    expect(completed).toBeGreaterThan(0);
  });
});

describe("bot identity", () => {
  it("assigns a distinct AI personality to each bot seat and none to the host", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    expect(game.seats[0].personality).toBeNull();
    expect(game.seats.slice(1).map((seat) => seat.personality)).toEqual(["MANIAC", "CALLING_STATION", "ROCK"]);
    expect(game.seats.slice(1).every((seat) => !seat.isHuman)).toBe(true);
  });
});

describe("room codes", () => {
  it("issues a shareable code only for private tables", () => {
    const publicGame = createGame(crypto.randomUUID(), "Host");
    expect(publicGame.isPrivate).toBe(false);
    expect(publicGame.roomCode).toBeNull();

    const privateGame = createGame(crypto.randomUUID(), "Host", undefined, { isPrivate: true });
    expect(privateGame.isPrivate).toBe(true);
    expect(privateGame.roomCode).toMatch(/^[A-Z0-9]{6}$/);
  });
});

describe("multi-human seating", () => {
  it("converts the first open bot seat into a human seat", () => {
    const hostToken = crypto.randomUUID();
    const guestToken = crypto.randomUUID();
    const game = createGame(hostToken, "Host");

    const { state, seatIndex } = claimSeat(game, guestToken, testProfile("Guest"));
    expect(seatIndex).toBe(1);
    expect(state.seats[1].isHuman).toBe(true);
    expect(state.seats[1].ownerToken).toBe(guestToken);
    expect(state.seats[1].personality).toBeNull();
    expect(state.seats[1].name).toBe("Guest");
  });

  it("returns the same seat on a repeat claim instead of taking another one", () => {
    const hostToken = crypto.randomUUID();
    const guestToken = crypto.randomUUID();
    const game = createGame(hostToken, "Host");

    const first = claimSeat(game, guestToken, testProfile("Guest"));
    const versionAfterFirstClaim = first.state.version;
    const second = claimSeat(first.state, guestToken, testProfile("Guest"));

    expect(second.seatIndex).toBe(first.seatIndex);
    expect(second.state.version).toBe(versionAfterFirstClaim);
  });

  it("refuses to seat a fifth player at a full table", () => {
    const hostToken = crypto.randomUUID();
    let game = createGame(hostToken, "Host");
    for (const name of ["Guest1", "Guest2", "Guest3"]) {
      game = claimSeat(game, crypto.randomUUID(), testProfile(name)).state;
    }
    expect(game.seats.every((seat) => seat.isHuman)).toBe(true);
    expect(() => claimSeat(game, crypto.randomUUID(), testProfile("Guest4"))).toThrow(/full/i);
  });

  it("rejects an action from a token that owns no seat", () => {
    const hostToken = crypto.randomUUID();
    const game = createGame(hostToken, "Host");
    expect(() => applyPlayerAction(game, { type: "check" }, crypto.randomUUID())).toThrow(/not seated/i);
  });

  it("lets a second human act on their own turn, while hiding cards from each other", () => {
    const hostToken = crypto.randomUUID();
    const guestToken = crypto.randomUUID();
    let game = createGame(hostToken, "Host");
    expect(game.status).toBe("playing");

    const claimed = claimSeat(game, guestToken, testProfile("Guest"));
    game = claimed.state;
    const guestSeatIndex = claimed.seatIndex;
    const versionAfterClaim = game.version;

    // Right after claiming, action is still with the host (auto-play always
    // stops at the first human seat), so the guest cannot act out of turn.
    expect(game.currentPlayer).not.toBe(guestSeatIndex);
    expect(() => applyPlayerAction(game, { type: "check" }, guestToken)).toThrow(/turn/i);

    // The host folding hands the turn straight to the guest, since she is the
    // next active seat and has not acted yet this betting round.
    game = applyPlayerAction(game, { type: "fold" }, hostToken);
    expect(game.currentPlayer).toBe(guestSeatIndex);

    const guestView = toSnapshot(game, guestToken);
    expect(guestView.legalActions).not.toBeNull();
    expect(guestView.seats[guestSeatIndex].holeCards.every(Boolean)).toBe(true);
    expect(guestView.seats[0].holeCards.every((card) => card === null)).toBe(true);

    const hostView = toSnapshot(game, hostToken);
    expect(hostView.legalActions).toBeNull();
    expect(hostView.seats[guestSeatIndex].holeCards.every((card) => card === null)).toBe(true);

    expect(() => applyPlayerAction(game, { type: "check" }, hostToken)).toThrow(/turn/i);
    game = applyPlayerAction(game, { type: "call" }, guestToken);
    expect(game.version).toBeGreaterThan(versionAfterClaim);
  });
});

describe("giving up a seat", () => {
  it("restores the seat's original bot identity, including for the host's own seat", () => {
    const hostToken = crypto.randomUUID();
    const guestToken = crypto.randomUUID();
    let game = createGame(hostToken, "Host");
    const claimed = claimSeat(game, guestToken, testProfile("Guest"));
    game = claimed.state;
    expect(game.seats[claimed.seatIndex].name).toBe("Guest");

    game = vacateSeat(game, guestToken);
    const restored = game.seats[claimed.seatIndex];
    expect(restored.isHuman).toBe(false);
    expect(restored.ownerToken).toBeNull();
    expect(restored.name).toBe("Maya");
    expect(restored.personality).toBe("MANIAC");

    game = vacateSeat(game, hostToken);
    expect(game.seats[0].isHuman).toBe(false);
    expect(game.seats[0].ownerToken).toBeNull();
    expect(game.seats[0].name).toBe("Jax");
  });

  it("rejects vacating a seat you don't own", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    expect(() => vacateSeat(game, crypto.randomUUID())).toThrow(/not seated/i);
  });

  it("lets go of a seat mid-turn without stalling the table", () => {
    const hostToken = crypto.randomUUID();
    let game = createGame(hostToken, "Host");
    expect(game.currentPlayer).toBe(0);

    game = applyPlayerAction(game, { type: "leave-seat" }, hostToken);
    expect(game.seats[0].isHuman).toBe(false);
    // Every remaining seat is a bot, so autoPlayBots should have run the hand
    // to completion (or at least moved play off the now-vacated seat).
    expect(game.currentPlayer === null || game.currentPlayer !== 0).toBe(true);
  });
});

describe("idle turn timeout", () => {
  it("leaves a fresh turn untouched", () => {
    const token = crypto.randomUUID();
    const game = createGame(token, "Host");
    const before = game.version;
    const { state, expiredSeatIds } = expireIdleTurn(game);
    expect(expiredSeatIds).toHaveLength(0);
    expect(state.version).toBe(before);
  });

  it("auto-resolves a human turn idle past the timeout, in exactly one version bump", () => {
    const token = crypto.randomUUID();
    const game = createGame(token, "Host");
    expect(game.currentPlayer).toBe(0);
    const hostSeatId = game.seats[0].id;
    game.turnStartedAt = new Date(Date.now() - TURN_TIMEOUT_MS - 1000).toISOString();

    const before = game.version;
    const { state, expiredSeatIds } = expireIdleTurn(game);
    expect(expiredSeatIds).toEqual([hostSeatId]);
    expect(state.version).toBe(before + 1);
    // The host was seat 0 and is no longer the current player (either folded
    // out, or checked and action moved on).
    expect(state.currentPlayer === null || state.currentPlayer !== 0 || state.seats[0].status === "folded")
      .toBe(true);
  });
});
