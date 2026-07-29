import { NextRequest, NextResponse } from "next/server";
import { claimBackstopGold } from "@/lib/server/profile-store";
import { persistenceMode } from "@/lib/server/game-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { CHEAPEST_TIER, TIER_CONFIG } from "@/lib/game/tiers";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "profile:gold:backstop", 10, 60 * 1000);
  if (limited) return limited;
  try {
    const token = request.cookies.get("river_session")?.value;
    if (!token) return NextResponse.json({ error: "Your profile session expired." }, { status: 401 });
    // The cheapest seat in the house is the eligibility bar: below this a
    // player literally cannot sit down anywhere.
    const profile = await claimBackstopGold(token, TIER_CONFIG[CHEAPEST_TIER].minBuyIn);
    return NextResponse.json({ profile, persistence: persistenceMode() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not top up your Gold.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
