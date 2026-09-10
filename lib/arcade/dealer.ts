import type { BlackjackOutcome, BlackjackPhase } from "./blackjack";

/**
 * The house dealers.
 *
 * Loki and Finn, two dogs in dress shirts and black bow ties, who deal
 * Blackjack together. This file is who they are in words: their names, their
 * breeds, and what they say. The painted art is drawn by
 * components/arcade/dealer-stage.tsx from the paths in dealer-scene.ts.
 *
 * The house used to be one human croupier called Vera. This file also
 * absorbed lib/arcade/dealer-rig.ts, which held the proportions, seat
 * positions, idle cycles and closed-form camera fit for a three.js scene
 * that built both dogs out of spheres, capsules and cones. That scene is
 * gone (it read as two balloon animals, which is not something a number in
 * a rig can fix), and the geometry went with it rather than being left
 * behind as a module nothing imports. Recover it with `git checkout 7d80251
 * -- lib/arcade/dealer-rig.ts lib/arcade/dealer-rig.test.ts
 * components/arcade/dealer-stage.tsx` if a real rigged model is ever sourced.
 * What survived is below: identity, which the 2D scene still needs.
 *
 * The copy never uses a pronoun for the dealer: they/them for a pair needs
 * no establishing, and a croupier does not need one to say "push".
 */

export type DogId = "loki" | "finn";

export interface DealerDog {
  id: DogId;
  name: string;
  /** Said once on the page, so the wackiness has an explanation attached. */
  breed: string;
}

/** Loki: the apricot one, on the left. */
const LOKI: DealerDog = {
  id: "loki",
  name: "Loki",
  breed: "Aussiedoodle · mid-size, apricot",
};

/** Finn: the black one, on the right. */
const FINN: DealerDog = {
  id: "finn",
  name: "Finn",
  breed: "Golden doodle · tall, Golden Retriever.",
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
 * Rendered in a speech bubble over the pair. This line was once just flavour,
 * with a note that it must never become a button, since a control that takes
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
 * outcome and the amount, so a line that restated either would be noise:
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
    case "player-resign":
      return "Your call. Next one.";
  }
}
