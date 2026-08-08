import { describe, expect, it } from "vitest";
import {
  deriveSceneModel,
  seatHasFeltCards,
  seatHoleCardsHidden,
} from "./scene-model";
import { card, makeGameSnapshot, makeSixSeats } from "./snapshot-fixture";

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

  it("carries the table's stakes tier through, for the bankroll props' baseline", () => {
    const snapshot = makeGameSnapshot({ tier: "500k" });
    expect(deriveSceneModel(snapshot).tier).toBe("500k");
  });
});

describe("seatHoleCardsHidden", () => {
  function seatModel(overrides: Partial<ReturnType<typeof deriveSceneModel>["seats"][number]>) {
    const snapshot = makeGameSnapshot({
      seats: makeSixSeats((position) =>
        position === 1 ? { holeCards: [null, null] } : {}
      ),
    });
    const model = deriveSceneModel(snapshot);
    return { ...model.seats[1], ...overrides };
  }

  it("is true for an in-hand seat with both cards redacted", () => {
    expect(seatHoleCardsHidden(seatModel({}))).toBe(true);
  });

  it("is false once either card is revealed (a showdown)", () => {
    expect(
      seatHoleCardsHidden(seatModel({ holeCards: [card("A", "spades"), null] })),
    ).toBe(false);
  });

  it("is false for a seat not in the hand at all", () => {
    expect(seatHoleCardsHidden(seatModel({ inHand: false }))).toBe(false);
  });

  it("is false for a seat with no cards dealt yet", () => {
    expect(seatHoleCardsHidden(seatModel({ holeCards: [] }))).toBe(false);
  });
});

describe("seatHasFeltCards", () => {
  function seatModel(overrides: Partial<ReturnType<typeof deriveSceneModel>["seats"][number]>) {
    const snapshot = makeGameSnapshot({
      seats: makeSixSeats((position) =>
        position === 1 ? { holeCards: [null, null] } : {}
      ),
    });
    const model = deriveSceneModel(snapshot);
    return { ...model.seats[1], ...overrides };
  }

  it("is true for an in-hand opponent holding a pair", () => {
    expect(seatHasFeltCards(seatModel({ isMine: false }))).toBe(true);
  });

  /*
   * The regression this predicate exists for. The local player's hand is DOM,
   * drawn upright in front of the rail, so nothing of it lies on the cloth —
   * but scene/fake-shadows.tsx used to loop over every in-hand seat and ground
   * one anyway, painting a soft dark decal on bare felt in the middle of that
   * player's own view.
   */
  it("is false for the local player, whose pair is DOM and off the felt", () => {
    expect(seatHasFeltCards(seatModel({ isMine: true }))).toBe(false);
  });

  it("is false for a seat not in the hand, and for one not yet dealt", () => {
    expect(seatHasFeltCards(seatModel({ isMine: false, inHand: false }))).toBe(false);
    expect(seatHasFeltCards(seatModel({ isMine: false, holeCards: [] }))).toBe(false);
  });

  /*
   * Face-down and face-up are BOTH on the felt — the modelled prop draws one
   * and the atlas the other. A shadow is owed either way, so this must not
   * accidentally become "hidden cards only".
   */
  it("is true whether the pair is still face down or revealed", () => {
    expect(seatHasFeltCards(seatModel({ isMine: false }))).toBe(true);
    expect(
      seatHasFeltCards(
        seatModel({ isMine: false, holeCards: [card("A", "spades"), card("K", "spades")] }),
      ),
    ).toBe(true);
  });

  it("never claims a seat neither renderer would draw", () => {
    // The two renderers partition exactly the seats this returns true for:
    // the prop takes the hidden ones, the atlas every other. Nothing on the
    // felt may fall outside that union, or something is drawn unshaded — or
    // shaded and undrawn, which is the bug above.
    const snapshot = makeGameSnapshot({
      seats: makeSixSeats((position) =>
        position % 2 === 0 ? { holeCards: [null, null] } : {}
      ),
    });
    for (const seat of deriveSceneModel(snapshot).seats) {
      if (!seatHasFeltCards(seat)) continue;
      const drawnByProp = seatHoleCardsHidden(seat);
      const drawnByAtlas = !seatHoleCardsHidden(seat);
      expect(drawnByProp !== drawnByAtlas).toBe(true);
    }
  });
});
