import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { claimSeat, toSnapshot } from "@/lib/game/engine";
import { clampBuyIn, TIER_CONFIG } from "@/lib/game/tiers";
import { findGameByRoomCode, getStoredGame, persistenceMode, persistSeatClaim } from "@/lib/server/game-store";
import { creditGold, ensureProfile, spendGold, updateProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

const bodySchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6}$/, "Room codes are 6 characters."),
  name: z.string().trim().min(1).max(18).optional(),
  buyIn: z.number().int().positive().optional(),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "games:join", 20, 60 * 1000);
  if (limited) return limited;
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter the 6-character room code." }, { status: 400 });
    }
    const gameId = await findGameByRoomCode(parsed.data.code);
    if (!gameId) return NextResponse.json({ error: "That room code doesn't match a table." }, { status: 404 });
    const loaded = await getStoredGame(gameId);
    if (!loaded) return NextResponse.json({ error: "That room code doesn't match a table." }, { status: 404 });

    const token = readOrCreateSessionToken(request);
    let profile = await ensureProfile(token, parsed.data.name);
    if (parsed.data.name && parsed.data.name !== profile.displayName) {
      profile = await updateProfile(token, {
        displayName: parsed.data.name,
        avatarPreset: profile.avatarPreset,
        accent: profile.accent,
      });
    }

    const config = TIER_CONFIG[loaded.tier];
    const targetSeatIndex = loaded.seats.findIndex((seat) => seat.ownerToken === null);
    // As in quick-play: only a genuinely empty (busted-out) seat spends
    // Gold for a fresh buy-in -- an active bot's seat is inherited as-is.
    const isFreshBuyIn = targetSeatIndex !== -1 && loaded.seats[targetSeatIndex].stack === 0;
    if (isFreshBuyIn && !profile.unlimitedGold && profile.goldBalance < config.minBuyIn) {
      return withSessionCookie(
        NextResponse.json(
          { error: `You need at least ${config.minBuyIn.toLocaleString()} Gold to join this table.` },
          { status: 400 },
        ),
        token,
      );
    }
    // Defaults to 1000 (matching the lobby's current "1K buy-in" label)
    // until the buy-in picker UI lands and sends a real chosen amount.
    const buyIn = clampBuyIn(loaded.tier, parsed.data.buyIn ?? 1000);
    if (isFreshBuyIn) profile = await spendGold(token, buyIn);

    let state;
    let seatIndex;
    try {
      const beforeVersion = loaded.version;
      ({ state, seatIndex } = claimSeat(loaded, token, profile, isFreshBuyIn ? buyIn : undefined));
      if (state.version !== beforeVersion) {
        await persistSeatClaim(state, state.seats[seatIndex].id);
      }
    } catch (claimError) {
      if (isFreshBuyIn) profile = await creditGold(token, buyIn).catch(() => profile);
      throw claimError;
    }

    const response = NextResponse.json({
      game: toSnapshot(state, token),
      persistence: persistenceMode(),
      profile,
    });
    return withSessionCookie(response, token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not join that table.";
    const status = message.includes("full") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
