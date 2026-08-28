import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createGame, toSnapshot } from "@/lib/game/engine";
import { CHEAPEST_TIER, STAKES_TIERS, type StakesTier } from "@/lib/game/tiers";
import { createStoredGame, listPublicPlayingGames, persistenceMode } from "@/lib/server/game-store";
import { creditGold, spendGold } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { withRequestSessionCookie } from "@/lib/server/session";
import { resolvePlayerForTableEntry } from "@/lib/server/table-entry";
import { resolveTierEntry } from "@/lib/server/tier-entry";

export const runtime = "nodejs";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(18).optional(),
  isPrivate: z.boolean().optional(),
  tier: z.enum(STAKES_TIERS).optional(),
  buyIn: z.number().int().positive().optional(),
});

/**
 * Public tables mid-hand, for the lobby's "watch a table" list. No session
 * or seat required to read this -- same no-auth-needed contract as
 * GET /api/games/[id], which is what actually backs the spectate view.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "games:list", 60, 60 * 1000);
  if (limited) return limited;
  try {
    const tables = await listPublicPlayingGames();
    return NextResponse.json({ tables });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not list tables.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Hosts a brand-new table: "Host Private Game" (isPrivate: true), or a fresh public table. */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "games:create", 10, 5 * 60 * 1000);
  if (limited) return limited;
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a name between 1 and 18 characters." }, { status: 400 });
    }
    const tier: StakesTier = parsed.data.tier ?? CHEAPEST_TIER;
    const resolved = await resolvePlayerForTableEntry(request, parsed.data.name);
    if (resolved instanceof NextResponse) return resolved;
    const { token: hostToken } = resolved;
    let profile = resolved.profile;
    const tierEntry = resolveTierEntry(
      request,
      hostToken,
      tier,
      profile,
      parsed.data.buyIn,
      (config) => `You need at least ${config.minBuyIn.toLocaleString()} Gold to play ${config.label} stakes.`,
    );
    if (tierEntry instanceof NextResponse) return tierEntry;
    const { buyIn } = tierEntry;

    profile = await spendGold(hostToken, buyIn);
    let game;
    try {
      game = createGame(hostToken, profile.displayName, profile, { isPrivate: parsed.data.isPrivate, tier, buyIn });
      await createStoredGame(game);
    } catch (createError) {
      profile = await creditGold(hostToken, buyIn).catch(() => profile);
      throw createError;
    }

    const response = NextResponse.json({
      game: toSnapshot(game, hostToken),
      persistence: persistenceMode(),
      profile,
    });
    return withRequestSessionCookie(request, response, hostToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the table.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
