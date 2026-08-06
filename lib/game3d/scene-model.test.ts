import { describe, expect, it } from "vitest";
import { deriveSceneModel } from "./scene-model";
import { makeGameSnapshot, makeSixSeats } from "./snapshot-fixture";

describe("deriveSceneModel", () => {
  it("rotates the requesting player's seat into slot 0", () => {
    const snapshot = makeGameSnapshot({
      seats: makeSixSeats((position) => ({
        isMine: position === 4,
        isHuman: position === 4,
      })),
    });
    const model = deriveSceneModel(snapshot);
    expect(model.seats[0].isMine).toBe(true);
    expect(model.seats[0].id).toBe("seat-4");
    // Order is preserved cyclically around the rotation.
    expect(model.seats.map((s) => s.id)).toEqual([
      "seat-4",
      "seat-5",
      "seat-0",
      "seat-1",
      "seat-2",
      "seat-3",
    ]);
  });

  it("keeps seat order untouched for a spectator with no seat", () => {
    const snapshot = makeGameSnapshot({
      seats: makeSixSeats(() => ({ isMine: false })),
      isSeated: false,
    });
    const model = deriveSceneModel(snapshot);
    expect(model.seats[0].id).toBe("seat-0");
  });

  it("holds the felt-sums-to-pot invariant: centre pile is pot minus standing bets", () => {
    const snapshot = makeGameSnapshot({
      pot: 260,
      seats: makeSixSeats((position) => ({
        streetBet: position < 2 ? 40 : 0,
      })),
    });
    const model = deriveSceneModel(snapshot);
    expect(model.potResting).toBe(180);
    const feltTotal =
      model.potResting + model.seats.reduce((sum, s) => sum + s.streetBet, 0);
    expect(feltTotal).toBe(model.pot);
  });

  it("never lets the centre pile go negative on a malformed snapshot", () => {
    const snapshot = makeGameSnapshot({
      pot: 10,
      seats: makeSixSeats(() => ({ streetBet: 40 })),
    });
    expect(deriveSceneModel(snapshot).potResting).toBe(0);
  });

  it("marks the acting seat thinking and exposes its slot for head tracking", () => {
    const snapshot = makeGameSnapshot({
      seats: makeSixSeats((position) => ({ isCurrent: position === 2 })),
    });
    const model = deriveSceneModel(snapshot);
    expect(model.activeSlot).toBe(2);
    expect(model.seats[2].mood).toBe("thinking");
    expect(model.seats[1].mood).toBe("idle");
  });

  it("a folded seat on its turn never thinks — only an active one", () => {
    const snapshot = makeGameSnapshot({
      seats: makeSixSeats((position) =>
        position === 2 ? { isCurrent: true, status: "folded" } : {}
      ),
    });
    expect(deriveSceneModel(snapshot).seats[2].mood).toBe("idle");
  });

  it("winners celebrate and carry their amounts", () => {
    const snapshot = makeGameSnapshot({
      street: "showdown",
      winners: [
        { seatId: "seat-3", name: "Kess", amount: 420, hand: "Flush", bestFive: null },
      ],
    });
    const model = deriveSceneModel(snapshot);
    const winner = model.seats.find((s) => s.id === "seat-3");
    expect(winner?.mood).toBe("celebrate");
    expect(winner?.winAmount).toBe(420);
    expect(model.hasWinners).toBe(true);
  });

  it("counts active and all-in seats as in the hand; folded and out are not", () => {
    const snapshot = makeGameSnapshot({
      seats: makeSixSeats((position) => ({
        status: (["active", "all-in", "folded", "out", "active", "folded"] as const)[
          position
        ],
      })),
    });
    const model = deriveSceneModel(snapshot);
    expect(model.seats.map((s) => s.inHand)).toEqual([
      true,
      true,
      false,
      false,
      true,
      false,
    ]);
  });
});
