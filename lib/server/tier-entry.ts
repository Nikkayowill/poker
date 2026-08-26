import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { clampBuyIn, TIER_CONFIG, type StakesTier, type TierConfig } from "@/lib/game/tiers";
import { withRequestSessionCookie } from "./session";
import type { PlayerProfile } from "@/lib/profile/types";

/**
 * The shared "can this profile afford this tier, and what's the real buy-in"
 * resolution every table-entry route (host, join, quick-play) needs before it
 * spends any Gold: look up the tier's config, refuse an underfunded profile,
 * and clamp the requested buy-in to the tier's fixed amount. This used to be
 * copy-pasted near-verbatim (including the same comment) across all three
 * routes -- see `resolvePlayerForTableEntry` in `./table-entry.ts` for the
 * sibling extraction this follows the same shape as.
 *
 * The join route's "already seated" case is genuinely different (a returning
 * player isn't buying a new seat, so they skip the balance check but still
 * get a clamped buy-in) -- callers pass `skipEligibilityCheck` for that
 * rather than this helper trying to infer it.
 *
 * Returns the tier's config and the clamped buy-in to continue with, or a
 * NextResponse to return immediately (the underfunded case, already
 * cookie-stamped so the caller doesn't have to remember to stamp it again).
 */
export function resolveTierEntry(
  request: NextRequest,
  token: string,
  tier: StakesTier,
  profile: PlayerProfile,
  requestedBuyIn: number | undefined,
  eligibilityMessage: (config: TierConfig) => string,
  skipEligibilityCheck = false,
): { config: TierConfig; buyIn: number } | NextResponse {
  const config = TIER_CONFIG[tier];
  if (!skipEligibilityCheck && !profile.unlimitedGold && profile.goldBalance < config.minBuyIn) {
    return withRequestSessionCookie(request,
      NextResponse.json({ error: eligibilityMessage(config) }, { status: 400 }),
      token,
    );
  }
  // Defaults to 1000 (matching the lobby's current "1K buy-in" label and
  // createGame's own default) until the tier/buy-in picker UI lands and
  // starts sending a real client-chosen amount.
  const buyIn = clampBuyIn(tier, requestedBuyIn ?? 1000);
  return { config, buyIn };
}
