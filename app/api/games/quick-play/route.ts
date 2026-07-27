import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { claimSeat, createGame, toSnapshot } from "@/lib/game/engine";
import { clampBuyIn, TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import {
  createStoredGame,
  findOpenPublicGame,
  getStoredGame,
  persistenceMode,
  persistSeatClaim,
} from "@/lib/server/game-store";
import { creditGold, ensureProfile, spendGold, updateProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(18).optional(),
  tier: z.enum(["micro", "mid", "high"]).optional(),
  buyIn: z.number().int().positive().optional(),
});

// A handful of attempts absorbs the rare case where another quick-play
// request claims the same open seat first; each retry re-queries for a
// still-open table rather than assuming the original one is still viable.
const MAX_CLAIM_ATTEMPTS = 4;

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "games:quick-play", 10, 60 * 1000);
  if (limited) return limited;
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a name between 1 and 18 characters." }, { status: 400 });
    }
    const tier: StakesTier = parsed.data.tier ?? "micro";
    const config = TIER_CONFIG[tier];
    const token = readOrCreateSessionToken(request);
    let profile = await ensureProfile(token, parsed.data.name);
    if (parsed.data.name && parsed.data.name !== profile.displayName) {
      profile = await updateProfile(token, {
        displayName: parsed.data.name,
        avatarPreset: profile.avatarPreset,
        accent: profile.accent,
      });
    }
    if (!profile.unlimitedGold && profile.goldBalance < config.minBuyIn) {
      return withSessionCookie(
        NextResponse.json(
          { error: `You need at least ${config.minBuyIn.toLocaleString()} Gold to play ${config.label} stakes.` },
          { status: 400 },
        ),
        token,
      );
    }
    // Defaults to 1000 (matching the lobby's current "1K buy-in" label and
    // createGame's own default) until the tier/buy-in picker UI lands and
    // starts sending a real client-chosen amount.
    const buyIn = clampBuyIn(tier, parsed.data.buyIn ?? 1000);

    let joined = null;
    for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS && !joined; attempt += 1) {
      const openGameId = await findOpenPublicGame(tier);
      if (!openGameId) break;
      const loaded = await getStoredGame(openGameId);
      if (!loaded) continue;
      const targetSeatIndex = loaded.seats.findIndex((seat) => seat.ownerToken === null);
      // A seat still holding its current stack (an active bot mid-session)
      // is inherited as-is, no purchase involved. Only a genuinely empty
      // (busted-out) seat spends Gold for a fresh buy-in.
      const isFreshBuyIn = targetSeatIndex !== -1 && loaded.seats[targetSeatIndex].stack === 0;
      if (isFreshBuyIn) profile = await spendGold(token, buyIn);
      try {
        const beforeVersion = loaded.version;
        const { state, seatIndex } = claimSeat(loaded, token, profile, isFreshBuyIn ? buyIn : undefined);
        if (state.version !== beforeVersion) {
          await persistSeatClaim(state, state.seats[seatIndex].id);
        }
        joined = state;
      } catch {
        if (isFreshBuyIn) profile = await creditGold(token, buyIn).catch(() => profile);
        // Someone else claimed the last open seat, or the table filled between
        // our lookup and our claim; loop around and search again.
      }
    }

    const game = joined ?? await (async () => {
      profile = await spendGold(token, buyIn);
      try {
        const created = createGame(token, profile.displayName, profile, { isPrivate: false, tier, buyIn });
        await createStoredGame(created);
        return created;
      } catch (createError) {
        profile = await creditGold(token, buyIn).catch(() => profile);
        throw createError;
      }
    })();

    const response = NextResponse.json({
      game: toSnapshot(game, token),
      persistence: persistenceMode(),
      profile,
    });
    return withSessionCookie(response, token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not find you a table.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
