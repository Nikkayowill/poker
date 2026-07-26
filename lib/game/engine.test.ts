import { describe, expect, it } from "vitest";
import { applyPlayerAction, createGame, toSnapshot } from "./engine";
import { evaluateHand } from "./evaluator";
import type { Card, PlayerAction } from "./types";

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
