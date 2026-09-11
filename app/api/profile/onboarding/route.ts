import { NextRequest, NextResponse } from "next/server";
import { completeOnboardingTour, ensureProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Marks the spotlight onboarding tour finished (or skipped) for the caller's
 * profile. A sibling of /api/profile/badges rather than a PUT /api/profile
 * field: that PUT requires the full display-field set on every call and this
 * is a one-way flag flip, fired once from lib/onboarding/use-onboarding-tour.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "profile:onboarding:complete", 20, 60 * 1000);
  if (limited) return limited;

  try {
    const token = readSessionToken(request);
    if (!token) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

    await completeOnboardingTour(token);
    const profile = await ensureProfile(token);
    return NextResponse.json({ profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save your tour progress.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
