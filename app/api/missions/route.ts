import { NextRequest, NextResponse } from "next/server";
import { getMissionsView } from "@/lib/server/mission-store";
import { ensureProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Today's and this week's missions, and the caller's progress on each.
 *
 * A sibling of /api/progression rather than a field folded into it: that
 * route is documented as a narrow single-row snapshot other callers (the 3D
 * table's corner HUD) depend on staying small, while missions is a growing
 * catalog with its own read shape. Open to guests for the same reason
 * progression is -- this is a readout of play a cookie has already done, not
 * an address into a durable profile id a guest lacks.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "missions:read", 60, 60 * 1000);
  if (limited) return limited;

  try {
    const token = readSessionToken(request);
    if (!token) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

    const profile = await ensureProfile(token);
    const missions = await getMissionsView(profile.id);

    return NextResponse.json(missions);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load your missions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
