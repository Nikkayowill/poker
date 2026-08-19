import { NextRequest, NextResponse } from "next/server";
import { getProfileBadges } from "@/lib/server/badge-store";
import { ensureProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * The badges a profile has earned -- season top-10 finishes and achievement
 * unlocks alike. A sibling of /api/achievements rather than a field folded
 * into /api/profile: GET /api/profile is on the hot path (poker-app.tsx
 * fetches it on load, gold-store, arcade-floor, rewards-hub), and badges are
 * only ever needed by the profile editor's own "Badges" section.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "profile:badges:read", 60, 60 * 1000);
  if (limited) return limited;

  try {
    const token = readSessionToken(request);
    if (!token) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

    const profile = await ensureProfile(token);
    const badges = await getProfileBadges(profile.id);

    return NextResponse.json({ badges });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load your badges.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
