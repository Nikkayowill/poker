import "server-only";
import { NextResponse } from "next/server";
import { isTipAmount, tipThanks, type TipAmount } from "@/lib/arcade/tipping";
import type { PlayerProfile } from "@/lib/profile/types";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import { ensureProfile, spendGold } from "./profile-store";
import { awardWager } from "./progression-store";

/**
 * Tipping Loki and Finn.
 *
 * The arcade's only pure SINK. Every other money path here has two sides -- a
 * stake goes out and a settlement comes back, and the ordering rules exist
 * because getting the sequence wrong pays somebody twice or nothing. A tip has
 * one side: the Gold leaves and does not return. That makes this the simplest
 * money path in the app and it is worth saying why the usual three rules
 * mostly do not apply, rather than leaving the next reader to wonder whether
 * they were forgotten.
 *
 *   1. The debit still comes FIRST, and everything after it is a consequence
 *      rather than a precondition. There is nothing to refund on failure
 *      because there is nothing to deal -- the player asked to give Gold away
 *      and the Gold went away.
 *   2. There is no settlement, so there is no version guard and nothing that
 *      must pay exactly once. The corresponding hazard for a sink is the
 *      opposite one -- CHARGING twice -- and it is handled at the edges: the
 *      route rate-limits, and the button disables in flight. A tip that is
 *      genuinely clicked twice charges twice, which is what the player asked
 *      for; the house is never at risk here, only the player's patience.
 *   3. spendGold is the authority on affordability. The check below is a
 *      courtesy that produces a better message; it is not a gate, and a stale
 *      read cannot let an unaffordable tip through because spendGold's own
 *      guard is what actually refuses.
 *
 * The XP award is deliberately last and deliberately non-fatal. awardWager
 * swallows its own errors by contract, so a progression outage cannot turn a
 * completed tip into an error response -- the player would then have paid and
 * been told it failed, which is the one outcome worth engineering against.
 */

export interface TipView {
  profile: PlayerProfile;
  /** What the pair say back, for the speech bubble. */
  thanks: string;
  amount: TipAmount;
}

export class TipRequestError extends ArcadeRequestError<never> {
  readonly name = "TipRequestError";
}

export function toTipErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That tip could not go through.");
}

/**
 * Takes a tip and hands back the pair's thanks.
 *
 * `amount` is re-validated here against the same TIP_AMOUNTS the buttons are
 * built from, not trusted from the body. The route parses it too; this is the
 * check that matters, because the service is what any future caller reaches.
 */
export async function tipDealer(token: string, amount: number): Promise<TipView> {
  if (!isTipAmount(amount)) {
    // An arbitrary number here would let a crafted request tip a fraction, a
    // negative (a withdrawal), or somebody's entire balance in one call.
    throw new TipRequestError("That is not a tip the dealers take.", 400);
  }

  let profile = await ensureProfile(token);

  if (!profile.unlimitedGold && profile.goldBalance < amount) {
    throw new TipRequestError(
      `You need ${amount.toLocaleString()} Gold to tip that much.`,
      400,
    );
  }

  profile = await spendGold(token, amount);

  /*
   * XP at the ordinary rate, through the same hook a wager uses.
   *
   * Not an exploit, and the arithmetic is the reason: XP is Gold-wagered / 10
   * everywhere in this app, so a player grinding levels by playing gives up the
   * arcade's ~3% edge, while a player grinding them by tipping gives up 100%.
   * Tipping is therefore the strictly worst way to buy a level that exists,
   * which is what stops it becoming the efficient one. See lib/arcade/tipping.ts.
   */
  const award = await awardWager(profile.id, token, amount);
  if (award?.profile) profile = award.profile;

  return { profile, thanks: tipThanks(amount), amount };
}
