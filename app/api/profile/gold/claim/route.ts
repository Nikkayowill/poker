import { NextRequest, NextResponse } from "next/server";
import { claimDailyGold } from "@/lib/server/profile-store";
import { persistenceMode } from "@/lib/server/game-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "profile:gold:claim", 10, 60 * 1000);
  if (limited) return limited;
  try {
    const token = request.cookies.get("river_session")?.value;
    if (!token) return NextResponse.json({ error: "Your profile session expired." }, { status: 401 });
    const profile = await claimDailyGold(token);
    return NextResponse.json({ profile, persistence: persistenceMode() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not claim your daily Gold.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
