import { NextRequest, NextResponse } from "next/server";
import { listNotifications } from "@/lib/server/notifications-store";
import { ensureProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * The caller's recent notifications and unread count.
 *
 * Open to guests, same as GET /api/achievements: two of the four kinds
 * (achievement_unlocked, mission_completed) apply to a guest's profile just
 * as much as a registered one's, so gating this behind requireRegisteredProfile
 * would hide half the feature from a guest who has earned it.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "notifications:read", 60, 60 * 1000);
  if (limited) return limited;

  try {
    const token = readSessionToken(request);
    if (!token) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

    const profile = await ensureProfile(token);
    return NextResponse.json(await listNotifications(profile.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load your notifications.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
