import { describe, expect, it } from "vitest";
import type { BlackjackOutcome } from "./blackjack";
import { DEALER_DOGS, DEALER_NAME, TIP_LINE, dealerLine } from "./dealer";

describe("dealerLine", () => {
  it("has something to say before a round exists", () => {
    expect(dealerLine(null, null)).toBe("Take a seat. Pick your stake.");
  });

  it("speaks once the cards are out", () => {
    expect(dealerLine("player-turn", null)).toBe("Cards are out.");
    expect(dealerLine("dealer-turn", null)).toBe("Playing it out.");
  });

  it("covers every outcome the engine can produce", () => {
    // Not a list restated by hand -- if BlackjackOutcome grows a member, this
    // fails to compile rather than silently returning undefined on the felt.
    const outcomes: Record<BlackjackOutcome, true> = {
      "player-blackjack": true,
      "player-win": true,
      "dealer-bust": true,
      "dealer-win": true,
      "player-bust": true,
      push: true,
      "player-resign": true,
    };
    for (const outcome of Object.keys(outcomes) as BlackjackOutcome[]) {
      const line = dealerLine("settled", outcome);
      expect(line, outcome).toBeTruthy();
      // Short enough to sit on one line beside the name; see .bj-hand-caption.
      expect(line.length, outcome).toBeLessThanOrEqual(28);
    }
  });

  it("distinguishes the two ways a player wins and the two ways they lose", () => {
    expect(dealerLine("settled", "player-blackjack")).not.toBe(dealerLine("settled", "player-win"));
    expect(dealerLine("settled", "dealer-bust")).not.toBe(dealerLine("settled", "player-win"));
    expect(dealerLine("settled", "player-bust")).not.toBe(dealerLine("settled", "dealer-win"));
  });

  it("names both dogs as themselves, not as players", () => {
    // Two single first names joined, not a product name. Deliberately NOT the
    // register the poker table's bot pool moved to on 2026-08-21 (gamer tags):
    // these two are Kayo's actual dogs dealing the game, staff rather than
    // someone you are playing against, and a handle over the dealer's chair
    // would make them one more seat.
    expect(DEALER_NAME).toMatch(/^[A-Z][a-z]+ & [A-Z][a-z]+$/);
    for (const dog of DEALER_DOGS) expect(DEALER_NAME).toContain(dog.name);
  });

  it("asks for a tip in a line short enough to sit in a bubble", () => {
    expect(TIP_LINE).toBe("Tip the dealer!");
    expect(TIP_LINE.length).toBeLessThanOrEqual(24);
  });
});

/*
 * These moved here from lib/arcade/dealer-rig.test.ts when the three.js stage
 * was deleted. They are the assertions that were about WHO these two are
 * rather than about how a mesh was assembled, and they outlive the renderer:
 * the flat 34px crop and the 2D scene both draw from the same cast.
 */
describe("the cast", () => {
  const [loki, finn] = DEALER_DOGS;

  it("is two different dogs, not one dog twice", () => {
    expect(loki.id).not.toBe(finn.id);
    expect(loki.name).not.toBe(finn.name);
  });

  it("tells them apart by coat, which is the whole read at 34px", () => {
    // The pair used to be distinguished by ear style -- one flop, one prick.
    // They are both drop-eared doodles now, so colour is the ONLY thing
    // carrying the difference, and it has to carry it hard. An apricot dog and
    // a black dog are about as far apart as two coats get; anything closer
    // than this and the crop beside the hand is one dog drawn twice.
    expect(loki.coat.base).not.toBe(finn.coat.base);
    const brightness = (hex: string) =>
      [1, 3, 5].reduce((sum, at) => sum + parseInt(hex.slice(at, at + 2), 16), 0) / 3;
    expect(brightness(loki.coat.base) - brightness(finn.coat.base)).toBeGreaterThan(80);
  });

  it("keeps the black dog off true black, so it has a silhouette at all", () => {
    // Finn is a black dog on an almost-black page. A #000 coat is a hole in
    // the picture, not a dog.
    const darkest = Math.min(...[1, 3, 5].map((at) => parseInt(finn.coat.base.slice(at, at + 2), 16)));
    expect(darkest).toBeGreaterThan(16);
  });

  it("gives the shaggier dog more coat", () => {
    expect(loki.fluff).toBeGreaterThan(finn.fluff);
  });

  it("dresses them both in the same house uniform", () => {
    expect(finn.uniform).toEqual(loki.uniform);
  });

  it("keeps the bow tie legible by putting a much lighter collar behind it", () => {
    // The tie is near-black -- sampled from the portraits in public/dealer/,
    // where it sits on an ivory shirt -- and DealerAvatar draws it on a dark
    // green disc. The collar is therefore the only thing making the one piece
    // of uniform in that drawing visible at all, which is exactly the kind of
    // dependency a later "simplification" deletes without noticing.
    //
    // It also guards the direction of the fix that created it: the uniform used
    // to be a green visor and a GOLD tie, neither of which is in the art. Gold
    // on green needed no help; black on green does.
    const brightness = (hex: string) =>
      [1, 3, 5].reduce((sum, at) => sum + parseInt(hex.slice(at, at + 2), 16), 0) / 3;

    for (const dog of DEALER_DOGS) {
      expect(brightness(dog.uniform.tie), `${dog.name} tie is not dark`).toBeLessThan(40);
      expect(
        brightness(dog.uniform.shirt) - brightness(dog.uniform.tie),
        `${dog.name} tie/collar contrast`,
      ).toBeGreaterThan(120);
    }
  });

  it("names a breed and a colour for each, so the joke has an explanation", () => {
    for (const dog of DEALER_DOGS) {
      expect(dog.breed.length, dog.name).toBeGreaterThan(8);
      // One line under a name in .dealer-stage-name -- two dogs' breeds
      // wrapping would push the caption up over their own paws.
      expect(dog.breed.length, dog.name).toBeLessThanOrEqual(40);
    }
  });
});
