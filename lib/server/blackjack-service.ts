import "server-only";
import { randomInt } from "crypto";
import { NextResponse } from "next/server";
import {
  dealRound,
  doubleDown,
  hit,
  legalBlackjackActions,
  resign,
  settlementPayout,
  stand,
  toBlackjackSnapshot,
  type BlackjackRound,
  type BlackjackSnapshot,
} from "@/lib/arcade/blackjack";
import { TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  ActiveBlackjackRoundExists,
  advanceBlackjackRound,
  createBlackjackRound,
  getActiveBlackjackRound,
  type BlackjackRoundTier,
  type StoredBlackjackRound,
} from "./blackjack-store";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import { creditGold, ensureProfile, spendGold } from "./profile-store";
import { awardWager } from "./progression-store";

/**
 * Everything that happens between a Blackjack request and the wallet.
 *
 * This sits in lib/server rather than inside the route handlers for the
 * reason CLAUDE.md gives for lib/game/seat-presence.ts and lib/arcade/games.ts:
 * vitest.config.ts only collects lib/ and app/, and money-moving logic buried
 * in a handler is logic that is awkward to test. The routes are left as
 * parse-authorise-respond.
 *
 * The ordering rules here are the whole safety argument, so they are stated
 * once, up front:
 *
 *   1. The stake is debited before the round exists. A deal that fails to
 *      persist refunds; a debit that fails never deals. The reverse order
 *      hands out a hand nobody paid for.
 *   2. A payout is credited only after the version-guarded write that settles
 *      the round has been confirmed. advanceBlackjackRound returns null when
 *      it loses that race, and null must never pay: that guard is what makes
 *      settlement happen exactly once under a double-click, a retry, or two
 *      tabs.
 *   3. The stake having already left the wallet is why settlement is a single
 *      credit of stake + netGold (see settlementPayout) rather than a second
 *      debit on a loss.
 *
 * Practice hands (stake 0) are the one exception to rule 1: there is nothing
 * to debit, and spendGold/creditGold both throw on a non-positive amount by
 * design (lib/server/profile-store.ts), so every practice code path below
 * skips them entirely rather than calling either with 0.
 */

export interface BlackjackView {
  round: BlackjackSnapshot | null;
  profile: PlayerProfile;
}

export class BlackjackRequestError extends ArcadeRequestError<BlackjackSnapshot> {
  readonly name = "BlackjackRequestError";
}

export type BlackjackAction = "hit" | "stand" | "double" | "resign";

/**
 * How long a round may sit dealt but untouched (still in player-turn) before
 * the next read force-resigns it. This is what closes the gap a resign
 * action alone cannot: a client that never sends another request at all --
 * tab closed, connection dropped -- rather than one that deliberately quits.
 * Without this, blackjack_rounds_one_active_per_profile locks that profile
 * out of Blackjack forever the moment it happens: exactly what happened live
 * to two real players before this existed (see CLAUDE.md's Known open items,
 * corrected 2026-09-01).
 *
 * Long enough that a player who's merely thinking, or whose phone locked,
 * never gets timed out from under them; short enough that an orphaned round
 * doesn't hold a stake and that profile's one active-round slot hostage for
 * long.
 */
const STALE_ROUND_TIMEOUT_MS = 30 * 60 * 1000;

/** Maps a thrown error to the response both Blackjack routes send. */
export function toBlackjackErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That hand could not be played.");
}

function view(stored: StoredBlackjackRound | null, profile: PlayerProfile): BlackjackView {
  return {
    round: stored ? toBlackjackSnapshot(stored.round, { id: stored.id, version: stored.version }) : null,
    profile,
  };
}

/**
 * Pays a settled round out. Never throws: the round is already durably
 * settled by the time this runs, so letting a credit failure bubble up would
 * turn a completed hand into an error response and lose the player their
 * result as well as their Gold. Logged loudly instead; this is the one way
 * the arcade can cost somebody real currency, and it needs to be greppable.
 */
async function payOut(
  token: string,
  stored: StoredBlackjackRound,
  fallback: PlayerProfile,
): Promise<PlayerProfile> {
  const payout = settlementPayout(stored.round);
  if (payout <= 0) return fallback;
  try {
    return await creditGold(token, payout);
  } catch (error) {
    console.error("blackjack.payout_credit_failed", {
      roundId: stored.id,
      profileId: stored.profileId,
      outcome: stored.round.outcome,
      payout,
      error,
    });
    return fallback;
  }
}

/**
 * Force-resigns `stored` if it has sat dealt but untouched past
 * STALE_ROUND_TIMEOUT_MS, and returns the live truth either way: the same
 * round back if it was not stale, null if the sweep just settled it (nothing
 * is active anymore, so the caller is free to deal a fresh one), or a fresh
 * read if a real action landed in the same instant (that action is the true
 * outcome, not this cleanup's -- same reasoning as rule 2 above). Never
 * throws and never pays: settlementPayout on a resign is always 0 (the whole
 * stake is forfeit, same as any other loss), so there is nothing to credit.
 */
async function settleIfStale(
  profileId: string,
  stored: StoredBlackjackRound,
  now: Date,
): Promise<StoredBlackjackRound | null> {
  const staleFor = now.getTime() - Date.parse(stored.updatedAt);
  if (stored.round.phase !== "player-turn" || staleFor < STALE_ROUND_TIMEOUT_MS) return stored;

  let advanced: StoredBlackjackRound | null;
  try {
    advanced = await advanceBlackjackRound(stored, resign(stored.round));
  } catch (error) {
    // Genuinely never throws, matching the doc comment: this sweep piggybacks
    // on what is documented elsewhere as a passive read (readBlackjackRound,
    // used to restore the felt after a refresh), so a transient write failure
    // here must not turn an ordinary page load into a 500. Leave the round as
    // still active -- the sweep just tries again on the next read.
    console.error("blackjack.stale_sweep_failed", { roundId: stored.id, profileId, error });
    return stored;
  }
  // A successful advance means the sweep just force-settled this round, so
  // there is nothing active left for the caller -- same as if it had never
  // existed. A lost race (null) means a real action landed in the same
  // instant; that real outcome is the true state, not this cleanup's, so
  // re-fetch it rather than trust the stale object this function was handed.
  return advanced ? null : await getActiveBlackjackRound(profileId);
}

/** The caller's live round, or null. Used to restore the felt after a refresh. */
export async function readBlackjackRound(token: string, now = new Date()): Promise<BlackjackView> {
  const profile = await ensureProfile(token);
  const found = await getActiveBlackjackRound(profile.id);
  const stored = found ? await settleIfStale(profile.id, found, now) : null;
  return view(stored, profile);
}

/**
 * Opens a round at the tier's stake, or a free practice hand.
 *
 * A caller who already has a live round gets it back untouched rather than an
 * error: a refresh, a back-button, or a second tab is a resume, not a second
 * wager, and dealing again would debit twice for one hand.
 *
 * Practice is Blackjack's own free mode: a $0 hand with nothing at risk, for
 * a player who wants to see how a hand plays before staking real Gold on the
 * tier ladder. It is a Blackjack-only concept: lib/game/tiers.ts stays
 * untouched because the poker lobby's real-money buy-in flow reads the same
 * STAKES_TIERS tuple, and a $0 rung there would leak a free buy-in into table
 * selection.
 */
export async function dealBlackjackRound(
  token: string,
  input: { tier: StakesTier } | { practice: true },
  now = new Date(),
): Promise<BlackjackView & { resumed: boolean }> {
  let profile = await ensureProfile(token);

  const found = await getActiveBlackjackRound(profile.id);
  const existing = found ? await settleIfStale(profile.id, found, now) : null;
  if (existing) return { ...view(existing, profile), resumed: true };

  let tier: BlackjackRoundTier;
  let stake: number;
  if ("practice" in input) {
    tier = "practice";
    stake = 0;
  } else {
    tier = input.tier;
    stake = TIER_CONFIG[input.tier].minBuyIn;
  }

  if (stake > 0 && !profile.unlimitedGold && profile.goldBalance < stake) {
    throw new BlackjackRequestError(
      `You need ${stake.toLocaleString()} Gold to sit at this table.`,
      400,
    );
  }

  // Rule 1: the stake leaves first, when there is one. A practice hand has
  // nothing to debit, so it skips spendGold entirely (see the note on the
  // money-ordering rules at the top of this file).
  if (stake > 0) profile = await spendGold(token, stake);

  // node:crypto's randomInt, not Math.random. The deck decides real Gold now,
  // and it is dealt here rather than in the browser precisely so its
  // randomness is not something the player can reach.
  const round = dealRound(stake, randomInt);

  let stored: StoredBlackjackRound;
  try {
    stored = await createBlackjackRound({ profileId: profile.id, tier, baseStake: stake, round });
  } catch (error) {
    // The hand never came into existence, so the player must not have paid
    // for it. Same make-them-whole shape as app/api/games/route.ts.
    if (stake > 0) profile = await creditGold(token, stake).catch(() => profile);
    if (error instanceof ActiveBlackjackRoundExists) {
      // Two deals raced and the other one won. Theirs is the real round.
      const live = await getActiveBlackjackRound(profile.id);
      if (live) return { ...view(live, profile), resumed: true };
      throw new BlackjackRequestError(error.message, 409);
    }
    throw error;
  }

  // A natural settles inside dealRound, so the round can be over before the
  // player has done anything. The insert is the once-only event that guards
  // this credit, the way the version bump guards the others. payOut already
  // skips crediting when settlementPayout is <= 0, which every practice
  // outcome is, since a $0 stake settles to netGold 0 on a win, a loss or a
  // push alike (see settlementPayout's own note), so there is no separate
  // practice check to add here.
  if (stored.status === "settled") profile = await payOut(token, stored, profile);

  // Progression is keyed to the wager, and the wager is real from here on: the
  // insert above succeeded, so this cannot credit XP for a hand that was rolled
  // back. Only a real wager earns XP; nothing was risked on a practice hand.
  // Awaited rather than fired and forgotten so a milestone payout is in the
  // balance this response carries; awardWager swallows its own failures, so a
  // progression outage cannot fail a dealt hand.
  if (stake > 0) {
    const award = await awardWager(profile.id, token, stake);
    if (award?.profile) profile = award.profile;
  }

  return { ...view(stored, profile), resumed: false };
}

/**
 * Plays one action against the caller's live round.
 *
 * `roundId` and `version` are both required and both checked. The version is
 * the interesting one: it pins the action to the exact state the player was
 * looking at, so a replayed Stand or a double-clicked Hit cannot draw a
 * second card from the same deck.
 */
export async function actOnBlackjackRound(
  token: string,
  input: { roundId: string; version: number; action: BlackjackAction },
  now = new Date(),
): Promise<BlackjackView> {
  let profile = await ensureProfile(token);

  const found = await getActiveBlackjackRound(profile.id);
  const current = found ? await settleIfStale(profile.id, found, now) : null;
  if (!current) {
    throw new BlackjackRequestError("You do not have a Blackjack round in progress.", 404);
  }
  if (current.id !== input.roundId || current.version !== input.version) {
    throw new BlackjackRequestError(
      "That round moved on. Here is where it actually stands.",
      409,
      { round: toBlackjackSnapshot(current.round, { id: current.id, version: current.version }) },
    );
  }

  const legal = legalBlackjackActions(current.round);
  if (!legal[input.action]) {
    throw new BlackjackRequestError(
      `You cannot ${input.action} on this hand.`,
      409,
      { round: toBlackjackSnapshot(current.round, { id: current.id, version: current.version }) },
    );
  }

  // Doubling stakes the opening wager a second time, so it is charged before
  // the card is drawn, and it is legal only on the opening two cards, which
  // is why the extra is exactly baseStake and not some fraction of `stake`.
  // A practice hand's baseStake is 0, so there is nothing to charge; same
  // "skip spendGold rather than call it with 0" guard dealBlackjackRound uses.
  let doubleCharge = 0;
  if (input.action === "double" && current.baseStake > 0) {
    if (!profile.unlimitedGold && profile.goldBalance < current.baseStake) {
      throw new BlackjackRequestError(
        "Not enough Gold to double this hand.",
        400,
        { round: toBlackjackSnapshot(current.round, { id: current.id, version: current.version }) },
      );
    }
    profile = await spendGold(token, current.baseStake);
    doubleCharge = current.baseStake;
  }

  const next: BlackjackRound =
    input.action === "hit" ? hit(current.round)
      : input.action === "stand" ? stand(current.round)
        : input.action === "double" ? doubleDown(current.round)
          : resign(current.round);

  const stored = await advanceBlackjackRound(current, next);
  if (!stored) {
    // Rule 2: a lost race did not happen, so it neither pays nor charges.
    if (doubleCharge > 0) profile = await creditGold(token, doubleCharge).catch(() => profile);
    const live = await getActiveBlackjackRound(profile.id);
    throw new BlackjackRequestError(
      "That round moved on. Here is where it actually stands.",
      409,
      { round: live ? toBlackjackSnapshot(live.round, { id: live.id, version: live.version }) : undefined },
    );
  }

  if (stored.status === "settled") profile = await payOut(token, stored, profile);

  // A double is a second wager on the same hand, so it earns XP like one. Only
  // after advanceBlackjackRound confirmed the write: the lost-race branch above
  // already refunded the charge, and XP for a wager that was refunded would be
  // the same bug in a different currency.
  if (doubleCharge > 0) {
    const award = await awardWager(profile.id, token, doubleCharge);
    if (award?.profile) profile = award.profile;
  }

  return view(stored, profile);
}
