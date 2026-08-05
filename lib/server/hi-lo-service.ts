import "server-only";
import { randomInt } from "crypto";
import { NextResponse } from "next/server";
import {
  callHiLo,
  dealHiLoRound,
  hiLoPayout,
  legalHiLoCalls,
  toHiLoSnapshot,
  type HiLoCall,
  type HiLoRound,
  type HiLoSnapshot,
} from "@/lib/arcade/hi-lo";
import { TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  ActiveArcadeRoundExists,
  advanceArcadeRound,
  createArcadeRound,
  getActiveArcadeRound,
  type StoredArcadeRound,
} from "./arcade-round-store";
import { creditGold, ensureProfile, spendGold } from "./profile-store";

/**
 * Everything between a Hi-Lo request and the wallet.
 *
 * The ordering rules are identical to lib/server/blackjack-service.ts and are
 * restated rather than referenced, because breaking one is a silent money bug
 * and the next person to touch this file should not have to open another one
 * to learn why the sequence is what it is:
 *
 *   1. The stake is debited BEFORE the round exists. A deal that fails to
 *      persist refunds; a debit that fails never deals. The reverse order
 *      hands out a card nobody paid for.
 *   2. A payout is credited only after the version-guarded write that settles
 *      the round is confirmed. advanceArcadeRound returns null when it loses
 *      that race, and null must never pay -- that is what makes settlement
 *      happen exactly once under a double-click, a retry, or two tabs.
 *   3. The stake having already left the wallet is why settlement is a single
 *      credit of stake + netGold (hiLoPayout) rather than a second debit on a
 *      loss.
 *
 * Hi-Lo is simpler than blackjack in one way that matters: there is no second
 * wager. One deal, one call, settled -- so the only Gold movements are the
 * opening debit and at most one closing credit.
 */

export const HI_LO_GAME = "hi-lo";

export interface HiLoView {
  round: HiLoSnapshot | null;
  profile: PlayerProfile;
}

export class HiLoRequestError extends Error {
  readonly status: number;
  /** Sent with the error so a client that fell out of sync re-renders from truth instead of guessing. */
  readonly round?: HiLoSnapshot;

  constructor(message: string, status: number, round?: HiLoSnapshot) {
    super(message);
    this.name = "HiLoRequestError";
    this.status = status;
    this.round = round;
  }
}

type StoredHiLo = StoredArcadeRound<HiLoRound>;

function snapshot(stored: StoredHiLo): HiLoSnapshot {
  return toHiLoSnapshot(stored.round, { id: stored.id, version: stored.version });
}

function view(stored: StoredHiLo | null, profile: PlayerProfile): HiLoView {
  return { round: stored ? snapshot(stored) : null, profile };
}

/**
 * Pays a settled round out. Never throws: the round is already durably
 * settled, so letting a credit failure bubble would turn a finished hand into
 * an error response and cost the player their result as well as their Gold.
 * Logged loudly instead -- this is the one way Hi-Lo can cost real currency.
 */
async function payOut(token: string, stored: StoredHiLo, fallback: PlayerProfile): Promise<PlayerProfile> {
  const payout = hiLoPayout(stored.round);
  if (payout <= 0) return fallback;
  try {
    return await creditGold(token, payout);
  } catch (error) {
    console.error("hi_lo.payout_credit_failed", {
      roundId: stored.id,
      profileId: stored.profileId,
      outcome: stored.round.outcome,
      payout,
      error,
    });
    return fallback;
  }
}

/** The caller's live round, or null. Restores the felt after a refresh. */
export async function readHiLoRound(token: string): Promise<HiLoView> {
  const profile = await ensureProfile(token);
  const stored = await getActiveArcadeRound<HiLoRound>(profile.id, HI_LO_GAME);
  return view(stored, profile);
}

/**
 * Opens a round at the tier's stake and turns one card face up.
 *
 * A caller who already has a live round gets it back untouched: a refresh, a
 * back-button or a second tab is a resume, not a second wager. Dealing again
 * would debit twice for one card -- and worse here than at blackjack, since
 * the player would be shown a different base card and lose the one they were
 * about to call.
 */
export async function dealHiLo(
  token: string,
  tier: StakesTier,
): Promise<HiLoView & { resumed: boolean }> {
  let profile = await ensureProfile(token);

  const existing = await getActiveArcadeRound<HiLoRound>(profile.id, HI_LO_GAME);
  if (existing) return { ...view(existing, profile), resumed: true };

  const stake = TIER_CONFIG[tier].minBuyIn;
  if (!profile.unlimitedGold && profile.goldBalance < stake) {
    throw new HiLoRequestError(`You need ${stake.toLocaleString()} Gold to play this stake.`, 400);
  }

  // Rule 1: the stake leaves first.
  profile = await spendGold(token, stake);

  // node:crypto's randomInt, not Math.random. The deck decides real Gold, and
  // it is shuffled here rather than in the browser precisely so its randomness
  // is not something the player can reach -- doubly so for Hi-Lo, where the
  // one card that decides the round is sitting on top of that deck.
  const round = dealHiLoRound(stake, randomInt);

  let stored: StoredHiLo;
  try {
    stored = await createArcadeRound<HiLoRound>({
      profileId: profile.id,
      game: HI_LO_GAME,
      tier,
      baseStake: stake,
      round,
      // Hi-Lo never settles on the deal -- there is always a call to make.
      settled: false,
    });
  } catch (error) {
    // The round never came into existence, so the player must not have paid
    // for it. Same make-them-whole shape as app/api/games/route.ts.
    profile = await creditGold(token, stake).catch(() => profile);
    if (error instanceof ActiveArcadeRoundExists) {
      const live = await getActiveArcadeRound<HiLoRound>(profile.id, HI_LO_GAME);
      if (live) return { ...view(live, profile), resumed: true };
      throw new HiLoRequestError(error.message, 409);
    }
    throw error;
  }

  return { ...view(stored, profile), resumed: false };
}

/**
 * The player's one call. Draws the next card, settles, pays.
 *
 * `roundId` and `version` are both required and both checked. The version
 * pins the call to the exact state the player was looking at, so a replayed
 * or double-fired request cannot draw a second card from the same deck --
 * which in this game would be handing them a free re-roll of the only card
 * that matters.
 */
export async function playHiLoCall(
  token: string,
  input: { roundId: string; version: number; call: HiLoCall },
): Promise<HiLoView> {
  let profile = await ensureProfile(token);

  const current = await getActiveArcadeRound<HiLoRound>(profile.id, HI_LO_GAME);
  if (!current) throw new HiLoRequestError("You do not have a Hi-Lo round in progress.", 404);

  if (current.id !== input.roundId || current.version !== input.version) {
    throw new HiLoRequestError("That round moved on. Here is where it actually stands.", 409, snapshot(current));
  }
  if (!legalHiLoCalls(current.round)[input.call]) {
    // Either the round is over, or the call cannot be won by any card -- the
    // engine returns the round unchanged for both, so catching it here is
    // what keeps a no-op from looking like a played round.
    throw new HiLoRequestError(`You cannot call ${input.call} on this card.`, 409, snapshot(current));
  }

  const next = callHiLo(current.round, input.call);
  const stored = await advanceArcadeRound<HiLoRound>(current, next, true);
  if (!stored) {
    // Rule 2: a lost race did not happen, so it does not pay.
    const live = await getActiveArcadeRound<HiLoRound>(profile.id, HI_LO_GAME);
    throw new HiLoRequestError(
      "That round moved on. Here is where it actually stands.",
      409,
      live ? snapshot(live) : undefined,
    );
  }

  profile = await payOut(token, stored, profile);
  return view(stored, profile);
}

/**
 * Maps a thrown error to the response both Hi-Lo routes send. Lives here
 * rather than beside the handlers because every other file under app/api is a
 * route.ts, and lib/server/api-auth.ts already established that a lib/server
 * module may hand back a NextResponse.
 */
export function toHiLoErrorResponse(error: unknown): NextResponse {
  if (error instanceof HiLoRequestError) {
    return NextResponse.json(
      { error: error.message, ...(error.round ? { round: error.round } : {}) },
      { status: error.status },
    );
  }
  // "Not enough Gold." comes back from spendGold's own guard, which is the
  // authority -- any balance check before it is only ever a stale read.
  const message = error instanceof Error ? error.message : "That round could not be played.";
  const status = message === "Not enough Gold." ? 400 : 500;
  return NextResponse.json({ error: message }, { status });
}
