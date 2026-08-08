import {
  BLACKJACK_PAYOUT,
  DEALER_STANDS_ON,
  type BlackjackOutcome,
  type BlackjackPhase,
} from "./blackjack";
import { DEALER_DOGS, type DogId } from "./dealer";

/**
 * The Blackjack room, as a stack of layers.
 *
 * The table used to be a WebGL panel of two primitive-built dogs dropped into
 * the top of the felt, with the real game drawn flat underneath it -- two
 * rooms, one of which contained a picture of the other. This module is the
 * contract for the thing that replaced it: ONE room, built as separate 2D
 * layers at known depths, with the live game rendered in the DOM on top.
 *
 * The stack, back to front:
 *
 *   room     the casino behind the table -- lamps, pillars, bokeh
 *   dealers  Loki and Finn, stood behind the table
 *   table    the felt, its layout print, the shoe and the discard tray
 *   play     live DOM: cards, totals, the verdict, the controls
 *
 * The dealers are BEHIND the table, not in front of it. They used to be in
 * front so their paws could drape over the rail, which was fine while they were
 * a flat CSS crop and wrong the moment photographic art landed -- see the note
 * in app/styles/27-dealer-stage.css for why occlusion is what sells the depth.
 *
 * SEPARATE LAYERS, NOT ONE FLATTENED IMAGE, and that is the whole design.
 * A single baked render cannot swap an expression, cannot let a card pass in
 * front of the rail, and re-bakes the entire room every time a dog's mouth
 * changes. Four files that composite at runtime cost the same bandwidth and
 * buy every one of those.
 *
 * WHY THE PATHS ARE NULLABLE. Every `src` below may be null, and null is not
 * an error state -- it is "no verified asset yet", the same convention
 * lib/audio/music-manifest.ts uses for an empty playlist and `status:
 * "coming-soon"` uses in lib/arcade/games.ts. The component paints a CSS
 * placeholder for any layer that has no file, so the page is complete and
 * correct before a single PNG exists and each asset can land on its own.
 * Dropping a file at the documented path and flipping one constant is the
 * entire remaining step per layer.
 *
 * WHY IT IS IN lib/. vitest.config.ts collects only lib/ and app/, so nothing
 * under components/ runs under `npm test`. The expression mapping below has to
 * be total over every phase and outcome the engine can produce -- a hole in it
 * is two dogs frozen mid-grin through a losing hand -- and that is exactly the
 * kind of thing worth catching without a browser.
 */

/* ------------------------------------------------------------------ *
 * Expressions.
 * ------------------------------------------------------------------ */

/**
 * What the dogs are doing, which is four drawings per dog and no more.
 *
 * Named for the MOMENT each one serves rather than for the face it wears, so
 * the art can be matched to the need instead of the need being bent to fit
 * whatever got drawn. A fifth would need a fifth pair of files and a reason;
 * these four cover every state the round machine can be in.
 */
export const DEALER_EXPRESSIONS = ["idle", "dealing", "cheer", "sympathy"] as const;

export type DealerExpression = (typeof DEALER_EXPRESSIONS)[number];

/**
 * Which face the pair is wearing, given where the round is.
 *
 * They CHEER when the player wins and commiserate when the player loses --
 * deliberately that way round, and not the house's way round. These two are
 * dogs the player is meant to like; a dealer that looks pleased while taking
 * your stake is a different, meaner joke than the one this feature is telling.
 *
 * A push is `idle` rather than a fifth face: nothing happened, and the verdict
 * chip beside them already says "Stake returned".
 */
export function dealerExpression(
  phase: BlackjackPhase | null,
  outcome: BlackjackOutcome | null,
): DealerExpression {
  if (phase === null) return "idle";
  if (phase !== "settled") return "dealing";

  switch (outcome) {
    case "player-blackjack":
    case "player-win":
    case "dealer-bust":
      return "cheer";
    case "dealer-win":
    case "player-bust":
      return "sympathy";
    case "push":
    case null:
      return "idle";
  }
}

/* ------------------------------------------------------------------ *
 * Art.
 * ------------------------------------------------------------------ */

/** Where every layer's file lives, if it exists yet. */
export const SCENE_ART_DIR = "/dealer";

export interface SceneArt {
  /**
   * The casino behind the table. Full bleed, and deliberately the only layer
   * allowed to be soft: it is the one thing in the picture nobody looks at,
   * and a sharp background competes with the cards for the same eye.
   */
  room: string | null;
  /**
   * The felt, its printed layout, the shoe and the discard tray. Occupies the
   * scene from the rail down, so its top edge is where the dealers' layer
   * stops.
   *
   * ITS PRINTED TEXT IS A RULE CLAIM AND MUST MATCH THE ENGINE. The first
   * reference for this table read "INSURANCE PAYS 2 TO 1" and "DEALER MUST HIT
   * SOFT 17"; lib/arcade/blackjack.ts implements no insurance at all and the
   * dealer STANDS on soft 17. Felt print is not decoration -- it is the same
   * promise the page header makes, six inches lower, and the two disagreeing
   * is the defect this project already fixed once in the Hi-Lo hub blurb.
   */
  table: string | null;
}

export const SCENE_ART: SceneArt = {
  room: null,
  table: null,
};

/**
 * The one drawing each dog definitely has: their card-holding portrait.
 *
 * Cut from the owner's reference sheet, which drew the pair as busts in shirt,
 * waistcoat and bow tie over a solid black plate -- so these were flood-filled
 * from the corners rather than keyed on black globally. That distinction is not
 * a detail: Finn is a black dog in a black waistcoat and a black bow tie, and a
 * global key punches straight through all three. The safe fuzz was measured
 * rather than guessed -- above ~3% the fill starts eating his tie and eyes --
 * and the cut was checked for interior holes and against a LIGHT background,
 * where a black fringe would show. Recut them that way or not at all.
 *
 * WHY A PORTRAIT AND NOT FOUR FACES. Only this one pose was drawn, and the
 * choice was between shipping the real art now with one expression or holding
 * all of it back until eight files exist. This is the former, and dogArt()
 * below falls back here for any expression without its own file.
 *
 * THE CONSEQUENCE, stated plainly so nobody reads it as a bug: the dogs do not
 * change face yet. dealerExpression() is still computed, still total over every
 * phase and outcome, and still reaches the DOM as `data-expression` -- but with
 * only a portrait behind it the pair hold this one look through a win and a
 * bust alike. Dropping `loki-cheer.webp` beside these and adding its entry to
 * DOG_ART is the whole step, per expression, with nothing else to change.
 */
const DOG_PORTRAIT: Record<DogId, string> = {
  loki: `${SCENE_ART_DIR}/loki.webp`,
  finn: `${SCENE_ART_DIR}/finn.webp`,
};

/**
 * Every dog-and-expression file that exists, keyed `<dog>-<expression>`.
 *
 * Empty today -- the pair are drawn from DOG_PORTRAIT above. Adding art is
 * adding entries here, and it is deliberately PARTIAL rather than a full
 * record, so the pair can be drawn one expression at a time instead of needing
 * all eight files before any of them can ship.
 */
const DOG_ART: Partial<Record<`${DogId}-${DealerExpression}`, string>> = {};

/**
 * One dog, wearing one expression.
 *
 * Two files per expression per dog, kept apart rather than drawn as a pair, so
 * one of them can react while the other holds -- and so the taller dog can be
 * moved a few pixels without re-rendering both. Falls back to the dog's
 * portrait, so this is null only for a dog with no art at all.
 */
export function dogArt(dog: DogId, expression: DealerExpression): string | null {
  return DOG_ART[`${dog}-${expression}`] ?? DOG_PORTRAIT[dog] ?? null;
}

/**
 * Whether the pair has real artwork, as opposed to the placeholder.
 *
 * The component needs this to decide between an <img> stack and the flat SVG
 * crop, and it is derived from the manifest rather than tracked separately so
 * the two cannot disagree about whether a file exists.
 */
export function dogArtReady(): boolean {
  return DEALER_DOGS.every((dog) =>
    DEALER_EXPRESSIONS.every((expression) => dogArt(dog.id, expression) !== null),
  );
}

/* ------------------------------------------------------------------ *
 * The felt print.
 * ------------------------------------------------------------------ */

/** `1.5` -> `"3 TO 2"`. Exact over the small ratios a casino actually pays. */
function asRatio(multiplier: number): string {
  for (let denominator = 1; denominator <= 20; denominator += 1) {
    const numerator = multiplier * denominator;
    if (Math.abs(numerator - Math.round(numerator)) < 1e-9) {
      return `${Math.round(numerator)} TO ${denominator}`;
    }
  }
  // Unreachable for any payout this engine can express, and a thrown error
  // beats printing "1.4142 TO 1" across the middle of the felt.
  throw new Error(`Cannot print ${multiplier} as a ratio.`);
}

/**
 * What is printed across the felt, DERIVED FROM THE ENGINE.
 *
 * This is the single most important function in the file, and it exists
 * because of a specific near-miss. The reference art commissioned for this
 * table had "INSURANCE PAYS 2 TO 1" and "DEALER MUST HIT SOFT 17" painted
 * across the cloth. lib/arcade/blackjack.ts implements no insurance at all,
 * and the dealer STANDS on soft 17 -- so the felt would have been promising
 * two rules the game does not have, one of them the exact opposite of the
 * rule it does have, six inches under a page header that states it correctly.
 *
 * Baking rules into a picture makes them unreviewable and untestable: no gate
 * in this repo can read a PNG. So the print is DOM text computed from
 * BLACKJACK_PAYOUT and DEALER_STANDS_ON, which means changing a house rule
 * changes the cloth in the same commit, and the felt cannot drift from the
 * engine even in principle.
 *
 * The table ART must therefore ship WITHOUT printed rules -- cloth, rail,
 * shoe and discard tray only. Anything painted on is a claim nothing can check.
 */
export function feltPrint(): readonly string[] {
  return [
    `BLACKJACK PAYS ${asRatio(BLACKJACK_PAYOUT)}`,
    `DEALER STANDS ON SOFT ${DEALER_STANDS_ON}`,
  ];
}
