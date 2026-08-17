import { NextRequest, NextResponse } from "next/server";
import { getAchievementsView } from "@/lib/server/achievement-store";
import { ensureProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Every achievement in the catalog and where this player stands on it.
 *
 * A sibling of /api/missions rather than a field folded into it: achievements
 * are permanent and lifetime-scoped where missions are periodic, and the two
 * pages read independently (challenges-floor.tsx / achievements-floor.tsx).
 * Open to guests for the same reason missions is -- this is a readout of play
 * a cookie has already done, not an address into a durable profile id a
 * guest lacks.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "achievements:read", 60, 60 * 1000);
  if (limited) return limited;

  try {
    const token = readSessionToken(request);
    if (!token) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

    const profile = await ensureProfile(token);
    const achievements = await getAchievementsView(profile.id);

    return NextResponse.json(achievements);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load your achievements.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
