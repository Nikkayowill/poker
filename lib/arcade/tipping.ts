/**
 * Tipping the dealer.
 *
 * "Tip the dealer!" was flavour for as long as it had no mechanic behind it,
 * and lib/arcade/dealer.ts carried an explicit note saying it must never
 * become a button, because a control that takes Gold and does nothing is a
 * defect dressed as a joke. This module is the mechanic that makes it a real
 * button.
 *
 * WHAT A TIP ACTUALLY DOES, since that is the question the note was protecting:
 *
 *   - the Gold leaves the wallet, permanently, to the house;
 *   - it earns progression XP at the ordinary rate, through the same
 *     awardWager hook a wager uses;
 *   - the pair react, and thank the player by name of amount.
 *
 * That XP is deliberately NOT a new curve, and it is worth stating why it is
 * not an exploit. XP is Gold-wagered / 10 everywhere in this app. A player who
 * grinds XP by *playing* gives up the arcade's ~3% edge; a player who grinds it
 * by *tipping* gives up 100%. Tipping is therefore the strictly worst way to
 * buy a level that exists, which is exactly what stops it becoming the
 * efficient one -- the same argument lib/server/hand-completion.ts makes about
 * chips and Gold being at parity across the buy-in boundary.
 *
 * WHEN IT APPEARS is the other half, and it is why this file exists rather
 * than a boolean in the component. An ask that is on screen from the first
 * frame is an ask nobody reads and everybody resents; the brief was that it
 * shows up after a few hands. So the offer has a cadence: quiet until the
 * player has actually been dealt to, and quiet again for a good while after
 * they have either paid or waved it away. All of it is a pure function of
 * counters, so `npm test` can walk a whole session and assert the pair are
 * never nagging.
 *
 * The CADENCE is client state and the DEBIT is server state, on purpose. How
 * often a bubble appears is presentation and costs nothing if a refresh
 * forgets it; how much Gold left the wallet is not, and lives in
 * lib/server/tip-service.ts behind the same ordering rules every other money
 * path in the arcade follows.
 */

/**
 * What a tip can be.
 *
 * Small, and deliberately NOT off the STAKES_TIERS ladder -- that rule governs
 * stakes, because a stake the ladder cannot select is a price no button can
 * charge. A tip is not a wager: the smallest tier is 1,000 Gold, which against
 * a 1,000 Gold hand would be a tip equal to the bet, and nobody tips the
 * dealer their whole stake.
 */
export const TIP_AMOUNTS = [25, 100, 500] as const;

export type TipAmount = (typeof TIP_AMOUNTS)[number];

export function isTipAmount(value: number): value is TipAmount {
  return (TIP_AMOUNTS as readonly number[]).includes(value);
}

/** Hands the player must have finished before the pair ask for anything. */
export const TIP_OFFER_AFTER_HANDS = 3;

/**
 * Hands of quiet after an offer is resolved, either way.
 *
 * Long enough that the second ask is a surprise rather than a nag, and the
 * same length whether the player paid or dismissed -- asking a payer again
 * sooner than a refuser is how a tip jar turns into a dark pattern.
 */
export const TIP_COOLDOWN_HANDS = 12;

export interface TipOfferState {
  /** Hands settled this session. */
  handsPlayed: number;
  /**
   * `handsPlayed` at the moment the last offer was resolved -- tipped OR
   * dismissed -- or null if the pair have never asked.
   */
  resolvedAtHand: number | null;
  /** A round is in progress. The dogs do not interrupt a live hand. */
  roundLive: boolean;
}

/**
 * Whether the pair are asking right now.
 *
 * Three gates, and the round-live one is not merely polite: the tip button
 * sits on the same felt as Hit and Stand, and a control that appears between a
 * player's eye and the Stand button mid-hand is a misclick waiting to charge
 * them for it.
 */
export function shouldOfferTip(state: TipOfferState): boolean {
  if (state.roundLive) return false;
  if (state.handsPlayed < TIP_OFFER_AFTER_HANDS) return false;
  if (state.resolvedAtHand === null) return true;
  return state.handsPlayed - state.resolvedAtHand >= TIP_COOLDOWN_HANDS;
}

/**
 * What the pair say once they have been tipped.
 *
 * Constants, and capped in the test the same way dealerLine is: this renders
 * in the speech bubble over the dogs, and variable-length prose on a felt is
 * what clipped the per-seat status pills off the poker table.
 */
export function tipThanks(amount: TipAmount): string {
  switch (amount) {
    case 25:
      return "Good dog money. Thanks!";
    case 100:
      return "Very generous. Thank you!";
    case 500:
      return "You're a legend. Thank you!";
  }
}

/*
 * There is no TIP_PROMPT constant, deliberately. The ask is TIP_LINE in
 * lib/arcade/dealer.ts -- "Tip the dealer!" -- which is the line the pair have
 * always had, and a second near-identical string here would be two places to
 * change the same sentence.
 */
