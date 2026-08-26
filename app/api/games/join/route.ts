import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { claimSeat, toSnapshot } from "@/lib/game/engine";
import { findGameByRoomCode, getStoredGame, persistenceMode, persistSeatClaim } from "@/lib/server/game-store";
import { creditGold, spendGold } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { withRequestSessionCookie } from "@/lib/server/session";
import { resolvePlayerForTableEntry } from "@/lib/server/table-entry";
import { resolveTierEntry } from "@/lib/server/tier-entry";

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

    const resolved = await resolvePlayerForTableEntry(request, parsed.data.name);
    if (resolved instanceof NextResponse) return resolved;
    const { token } = resolved;
    let profile = resolved.profile;

    const alreadySeated = loaded.seats.some((seat) => seat.ownerToken === token);
    // As in quick-play, every seat claim is a real buy-in: chips are
    // redeemable for Gold on cash-out, so a free seat would be a faucet.
    // An already-seated player isn't buying a new one, so they skip the
    // eligibility check but still get a clamped buy-in.
    const tierEntry = resolveTierEntry(
      request,
      token,
      loaded.tier,
      profile,
      parsed.data.buyIn,
      (config) => `You need at least ${config.minBuyIn.toLocaleString()} Gold to join this table.`,
      alreadySeated,
    );
    if (tierEntry instanceof NextResponse) return tierEntry;
    const { buyIn } = tierEntry;
    if (!alreadySeated) profile = await spendGold(token, buyIn);

    let state;
    let seatIndex;
    try {
      const beforeVersion = loaded.version;
      ({ state, seatIndex } = claimSeat(loaded, token, profile, buyIn));
      if (state.version !== beforeVersion) {
        await persistSeatClaim(state, state.seats[seatIndex].id);
      }
    } catch (claimError) {
      if (!alreadySeated) profile = await creditGold(token, buyIn).catch(() => profile);
      throw claimError;
    }

    const response = NextResponse.json({
      game: toSnapshot(state, token),
      persistence: persistenceMode(),
      profile,
    });
    return withRequestSessionCookie(request, response, token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not join that table.";
    const status = message.includes("full") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
