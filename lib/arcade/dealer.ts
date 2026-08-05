import type { BlackjackOutcome, BlackjackPhase } from "./blackjack";

/**
 * The house dealer.
 *
 * A name and a line, kept here rather than inside the component for the
 * reason lib/arcade/games.ts exists: vitest.config.ts collects only lib/ and
 * app/, so anything under components/ is unreachable by `npm test`. The
 * drawing itself is components/arcade/dealer-avatar.tsx -- this is everything
 * about the character that can be wrong.
 *
 * Single first name, matching the eighteen-strong bot pool in
 * lib/game/engine.ts ("Jax", "Maya", "Theo", ...) so the arcade does not
 * suddenly speak in a different register from the poker table. The copy
 * deliberately never uses a pronoun for the dealer: nothing about the
 * character establishes one, and a croupier does not need one to say "push".
 */
export const DEALER_NAME = "Vera";

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
