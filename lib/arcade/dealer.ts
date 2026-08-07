import type { BlackjackOutcome, BlackjackPhase } from "./blackjack";

/**
 * The house dealers.
 *
 * Loki and Finn, two dogs in dress shirts and black bow ties, who deal
 * Blackjack together. This file is everything about them that can be wrong in
 * WORDS or in COLOUR: their names, their breeds, their coats, the house
 * uniform, and what they say. The drawings are
 * components/arcade/dealer-stage.tsx (the layered scene on the felt) and
 * components/arcade/dealer-avatar.tsx (the 34px crop beside the hand), and both
 * read their colours from here rather than typing hex values in twice -- two
 * drawings of the same two dogs that disagree about what colour they are is
 * the exact drift that makes a mascot look like clip art.
 *
 * The house used to be one human croupier called Vera.
 *
 * WHAT USED TO BE HERE. This file absorbed lib/arcade/dealer-rig.ts, which
 * held the proportions, seat positions, idle cycles and closed-form camera fit
 * for a three.js scene that built both dogs out of spheres, capsules and
 * cones. That scene is gone -- it read as two balloon animals, which is not
 * something a number in a rig can fix -- and the geometry went with it rather
 * than being left behind as a module nothing imports. Recover it with
 * `git checkout 7d80251 -- lib/arcade/dealer-rig.ts lib/arcade/dealer-rig.test.ts
 * components/arcade/dealer-stage.tsx` if a real rigged model is ever sourced.
 * What survived is below: identity, which the flat crop and the 2D scene both
 * still need.
 *
 * The copy never uses a pronoun for the dealer -- they/them for a pair needs
 * no establishing, and a croupier does not need one to say "push".
 */

export type DogId = "loki" | "finn";

/** A dog's colours. Six fields, because a seventh never survives at 34px. */
export interface DogCoat {
  /** The main coat. */
  base: string;
  /** The shadowed curls -- under the ears, beneath the jaw, over the crown. */
  saddle: string;
  /** Muzzle, chest and shirt front -- the light markings that give a face a centre. */
  cream: string;
  /** Nose leather. */
  nose: string;
  /** Iris. */
  eye: string;
  /** Tongue, for the open-mouthed line delivery. */
  tongue: string;
}

/**
 * The house uniform: an ivory dress shirt, a black waistcoat and a black bow
 * tie. Sampled from the portraits in `public/dealer/`, not chosen, for the same
 * reason the brand palette was pulled off the logo PNG with ImageMagick -- a
 * hex typed by eye beside a photograph drifts from it, and this file exists to
 * stop the flat crop and the real art disagreeing.
 *
 * IT USED TO BE A GREEN CROUPIER'S VISOR AND A GOLD BOW TIE, and that was
 * wrong: no such visor exists in the art and the tie is black. It went
 * unnoticed because the only drawing reading these values was the placeholder,
 * which stops rendering the moment real art lands -- so the drift was invisible
 * on Blackjack and live on every other arcade game, all five of which still
 * draw the flat crop. Two drawings of the same two dogs disagreeing about what
 * they are wearing is the exact failure this file is here to prevent.
 */
export interface DogUniform {
  /**
   * The dress shirt, and the collar the bow tie sits on.
   *
   * NOT DECORATION. The tie is near-black and the avatar's disc is dark green,
   * so without the shirt behind it the one piece of uniform in that drawing is
   * invisible at any size. The art solves it the same way, which is why this is
   * a field rather than a shape hard-coded in the component.
   */
  shirt: string;
  /** The waistcoat over that shirt. */
  waistcoat: string;
  /** Bow tie. Black, and it needs `shirt` behind it to read at all. */
  tie: string;
}

export interface DealerDog {
  id: DogId;
  name: string;
  /** Said once on the page, so the wackiness has an explanation attached. */
  breed: string;
  coat: DogCoat;
  uniform: DogUniform;
  /**
   * How much the silhouette is broken up by coat, 0 to 1.
   *
   * The one proportion worth keeping from the deleted rig, because it is the
   * only one the flat crop still draws: Loki is the shaggier of the two, with
   * longer ear feathering, and Finn's curls sit tighter.
   */
  fluff: number;
}

/**
 * Loki: the apricot one, on the left.
 *
 * The coats below are the pair as they actually look, taken from the owner's
 * own reference sheet. An earlier version of this file had Loki as a BLUE
 * MERLE with blue eyes and Finn as a tall golden -- both wrong, and wrong in a
 * way no test could catch, because a coat colour is only checkable against the
 * animal. Do not retune these by eye against a render; check them against a
 * photograph.
 */
const LOKI: DealerDog = {
  id: "loki",
  name: "Loki",
  breed: "Aussiedoodle · mid-size, apricot",
  coat: {
    base: "#d99b5c",
    saddle: "#a96f38",
    cream: "#f4e0c4",
    nose: "#241c18",
    eye: "#4a3225",
    tongue: "#e0868f",
  },
  uniform: {
    shirt: "#d6bda3",
    waistcoat: "#1b1611",
    tie: "#14100c",
  },
  fluff: 0.85,
};

/**
 * Finn: the black one, on the right.
 *
 * `base` is deliberately not #000. Finn is a black dog rendered against a dark
 * casino and an almost-black page, and a true black coat has no silhouette at
 * all in that picture -- what reads as "black dog" on screen is a very dark
 * warm grey with the curls picked out lighter still.
 */
const FINN: DealerDog = {
  id: "finn",
  name: "Finn",
  breed: "Shepherd doodle · tall, black",
  coat: {
    base: "#332e30",
    saddle: "#1c1819",
    cream: "#efe6dc",
    nose: "#141112",
    eye: "#4a3a2c",
    tongue: "#e0868f",
  },
  uniform: {
    shirt: "#d6bda3",
    waistcoat: "#1b1611",
    tie: "#14100c",
  },
  fluff: 0.62,
};

/**
 * The pair, in the order they sit: Loki on the left, Finn on the right.
 *
 * A tuple rather than an array so callers get exactly two dogs and can
 * destructure them without a length check.
 */
export const DEALER_DOGS: readonly [DealerDog, DealerDog] = [LOKI, FINN];

export const DEALER_NAME = DEALER_DOGS.map((dog) => dog.name).join(" & ");

/**
 * What the dogs want.
 *
 * Rendered in a speech bubble over the pair. This used to be flavour with an
 * explicit note saying it must never become a button -- a control that takes
 * Gold and does nothing is a defect dressed as a joke. Tipping is a real
 * mechanic now (lib/arcade/tipping.ts), so the line is still the ask and the
 * button beside it does something; the note stands for anything else that
 * might be tempted onto this felt.
 */
export const TIP_LINE = "Tip the dealer!";

/**
 * What the dealer says, given where the round is.
 *
 * Terse on purpose. This sits beside a verdict chip that already names the
 * outcome and the amount, so a line that restated either would be noise --
 * the dealer's job here is tone, not information. Every string is a constant,
 * so it cannot grow to the length that made the old per-seat status pills clip
 * under the poker table (see the note on `.status-pill` in CLAUDE.md).
 */
export function dealerLine(
  phase: BlackjackPhase | null,
  outcome: BlackjackOutcome | null,
): string {
  if (phase === null) return "Take a seat. Pick your stake.";
  if (phase === "player-turn") return "Cards are out.";
  if (outcome === null) return "Playing it out.";
  switch (outcome) {
    case "player-blackjack":
      return "Blackjack. Three to two.";
    case "player-win":
      return "That one's yours.";
    case "dealer-bust":
      return "Too many. Yours.";
    case "dealer-win":
      return "House takes it.";
    case "player-bust":
      return "Over. Next one.";
    case "push":
      return "Push. Stake back.";
  }
}
