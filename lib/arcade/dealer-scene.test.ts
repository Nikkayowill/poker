import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BLACKJACK_PAYOUT,
  DEALER_STANDS_ON,
  handTotal,
  legalBlackjackActions,
  type BlackjackOutcome,
  type BlackjackPhase,
} from "./blackjack";
import { DEALER_DOGS } from "./dealer";
import {
  DEALER_EXPRESSIONS,
  SCENE_ART,
  dealerExpression,
  dogArt,
  dogArtReady,
  feltPrint,
} from "./dealer-scene";

describe("dealerExpression", () => {
  it("is idle before a round exists", () => {
    expect(dealerExpression(null, null)).toBe("idle");
  });

  it("is dealing for the whole of a live hand", () => {
    expect(dealerExpression("player-turn", null)).toBe("dealing");
    expect(dealerExpression("dealer-turn", null)).toBe("dealing");
  });

  it("covers every outcome the engine can produce", () => {
    // Not a list restated by hand -- if BlackjackOutcome grows a member this
    // fails to compile, rather than the dogs silently freezing mid-grin on a
    // state nobody mapped. Same shape as dealer.test.ts's guard on dealerLine.
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
      const expression = dealerExpression("settled", outcome);
      expect(DEALER_EXPRESSIONS, outcome).toContain(expression);
    }
  });

  it("cheers when the player wins and commiserates when they lose", () => {
    // The direction matters and is the one thing here worth pinning: these are
    // dogs the player is meant to like, and a pair that look pleased while
    // taking a losing stake is a meaner joke than the feature is telling.
    for (const win of ["player-blackjack", "player-win", "dealer-bust"] as const) {
      expect(dealerExpression("settled", win), win).toBe("cheer");
    }
    for (const loss of ["dealer-win", "player-bust"] as const) {
      expect(dealerExpression("settled", loss), loss).toBe("sympathy");
    }
  });

  it("treats a push as nothing having happened", () => {
    expect(dealerExpression("settled", "push")).toBe("idle");
  });

  it("never returns undefined for any phase the round machine can be in", () => {
    const phases: Record<BlackjackPhase, true> = {
      "player-turn": true,
      "dealer-turn": true,
      settled: true,
    };
    for (const phase of Object.keys(phases) as BlackjackPhase[]) {
      for (const outcome of [null, "push", "player-win", "dealer-win"] as const) {
        expect(DEALER_EXPRESSIONS).toContain(dealerExpression(phase, outcome));
      }
    }
  });
});

describe("the art manifest", () => {
  /*
   * These assert the SHAPE of "no asset yet", not that the assets are missing.
   * When real files land, dogArt starts returning paths and dogArtReady flips
   * to true -- at which point the two placeholder assertions below should be
   * replaced by their opposites rather than deleted, because the thing worth
   * guarding is that the manifest and the readiness predicate always agree.
   */

  it("declares four expressions and no more", () => {
    // Four drawings per dog is the whole art order. A fifth needs a fifth pair
    // of files and a reason, which is a decision, not a default.
    expect(DEALER_EXPRESSIONS).toHaveLength(4);
    expect(new Set(DEALER_EXPRESSIONS).size).toBe(4);
  });

  it("keeps the readiness predicate honest about the manifest", () => {
    const everyDogDrawn = DEALER_DOGS.every((dog) =>
      DEALER_EXPRESSIONS.every((expression) => dogArt(dog.id, expression) !== null),
    );
    expect(dogArtReady()).toBe(everyDogDrawn);
  });

  it("keeps the rules off the artwork, where nothing could check them", () => {
    // The table art must ship as cloth, rail, shoe and tray only. This is the
    // assertion that would have caught the reference sheet: it had two printed
    // rules, and both were wrong.
    expect(SCENE_ART.table).toBeNull();
    expect(feltPrint().length).toBeGreaterThan(0);
  });

  it("uses null rather than a broken path for the layers still unshipped", () => {
    // The music-manifest convention: a null is "not sourced yet" and renders
    // a placeholder, where a string pointing at a file that does not exist is
    // a 404 in the middle of the felt. The room and the table are still null;
    // the dogs are not, which is what the next two tests are about.
    expect(SCENE_ART.room).toBeNull();
    expect(SCENE_ART.table).toBeNull();
  });

  it("draws both dogs at every expression", () => {
    // The opposite of the assertion this test replaced, which pinned that every
    // dogArt() was null while the art was outstanding. It is kept rather than
    // deleted because the thing worth guarding was never "there is no art" --
    // it is that the manifest and dogArtReady() agree, and a hole here is the
    // flat placeholder crop silently coming back in place of the real pair.
    for (const dog of DEALER_DOGS) {
      for (const expression of DEALER_EXPRESSIONS) {
        expect(dogArt(dog.id, expression), `${dog.id}/${expression}`).not.toBeNull();
      }
    }
    expect(dogArtReady()).toBe(true);
  });

  it("points every art path at a file that is actually on disk", () => {
    /*
     * The one assertion that can tell a manifest entry from a 404, and the
     * reason it is worth reaching for the filesystem in a unit test: nothing
     * else in this repo can. A typo'd path type-checks, renders, and shows two
     * broken images in the middle of the felt -- and dogArtReady() would be
     * true, so not even the placeholder would come back to cover it.
     */
    for (const dog of DEALER_DOGS) {
      for (const expression of DEALER_EXPRESSIONS) {
        const src = dogArt(dog.id, expression);
        expect(src, `${dog.id}/${expression}`).not.toBeNull();
        // Paths are web-absolute (`/dealer/...`) and served from public/.
        const file = join(process.cwd(), "public", src as string);
        expect(existsSync(file), `${src} is missing from public/`).toBe(true);
      }
    }
  });
});

/**
 * The felt print, which is a rule claim and therefore a thing that can be
 * WRONG rather than merely ugly.
 *
 * The reference art for this table arrived printed with "INSURANCE PAYS 2 TO 1"
 * and "DEALER MUST HIT SOFT 17". This engine has no insurance and the dealer
 * stands on soft 17 -- the felt would have contradicted the page header six
 * inches above it, and nothing in the repo could have caught it, because no
 * gate here reads a PNG. These are the assertions that make that impossible.
 */
describe("what the cloth says", () => {
  it("quotes the payout the engine actually pays", () => {
    expect(BLACKJACK_PAYOUT).toBe(1.5);
    expect(feltPrint()).toContain("BLACKJACK PAYS 3 TO 2");
  });

  it("says the dealer STANDS on soft 17, which is what stand() does", () => {
    expect(DEALER_STANDS_ON).toBe(17);
    expect(feltPrint()).toContain("DEALER STANDS ON SOFT 17");

    // Not merely the same number -- the same behaviour. A soft 17 is a hand
    // the dealer does not draw to, so this pins the word "STANDS" to the code
    // rather than to a constant that happens to read 17.
    const soft17 = handTotal([
      { rank: "A", suit: "hearts" },
      { rank: "6", suit: "clubs" },
    ]);
    expect(soft17.total).toBe(17);
    expect(soft17.soft).toBe(true);
    expect(soft17.total >= DEALER_STANDS_ON).toBe(true);
  });

  it("never prints a rule this game does not implement", () => {
    // Insurance, splitting and the casino "surrender" rule (half the stake
    // back) are all absent from the engine. `resign` is a real fourth verb
    // but not a casino rule this cloth would advertise -- see
    // lib/arcade/blackjack.ts's own header on the distinction -- so it is
    // exempted from the "must not advertise a fourth" check rather than
    // added to the forbidden-words list below.
    const verbs = Object.keys(legalBlackjackActions({
      phase: "player-turn",
      playerHand: [{ rank: "9", suit: "hearts" }, { rank: "7", suit: "clubs" }],
      dealerHand: [{ rank: "5", suit: "spades" }],
      deck: [],
      stake: 100,
      baseStake: 100,
      doubled: false,
      outcome: null,
      dealerHoleHidden: true,
    } as never));
    expect(new Set(verbs)).toEqual(new Set(["hit", "stand", "double", "resign"]));

    const cloth = feltPrint().join(" ").toLowerCase();
    for (const absent of ["insurance", "split", "surrender", "even money", "must hit"]) {
      expect(cloth, absent).not.toContain(absent);
    }
  });

  it("prints in the register a felt prints in", () => {
    for (const line of feltPrint()) {
      expect(line).toBe(line.toUpperCase());
      // One line across the cloth, so it cannot wrap into the card area.
      expect(line.length, line).toBeLessThanOrEqual(34);
    }
  });
});
