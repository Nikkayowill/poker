import { NextRequest, NextResponse } from "next/server";
import { cosmetics } from "@/lib/cosmetics/catalog";
import { listOwnedCosmetics } from "@/lib/server/cosmetics-store";
import { ensureProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";
import { getPlayerStanding } from "@/lib/server/stats-store";

export const runtime = "nodejs";

/**
 * The full catalog plus what this player owns, has equipped, and (for the
 * progress bars on locked hands-won/chips-won avatars) their own lifetime
 * stats. Every other route reading PlayerStats does it for a leaderboard;
 * this is the one place it's read purely to answer "how close am I."
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "cosmetics:list", 60, 60 * 1000);
  if (limited) return limited;
  try {
    // Browsing the catalog is not entering the room, so a caller with no
    // session gets it with nothing owned rather than a fresh throwaway
    // profile. Purchase and equip still require a real session.
    const token = readSessionToken(request);
    if (!token) {
      return NextResponse.json({ cosmetics, owned: [], equipped: null, profile: null, stats: null });
    }
    const profile = await ensureProfile(token);
    const [owned, standing] = await Promise.all([
      listOwnedCosmetics(profile.id),
      getPlayerStanding(profile.id, "lifetime"),
    ]);
    return NextResponse.json({
      cosmetics,
      owned,
      equipped: profile.equipped,
      profile,
      stats: standing?.stats ?? { handsWon: 0, totalChipsWon: 0 },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the collection.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
