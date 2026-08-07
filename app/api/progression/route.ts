import { NextRequest, NextResponse } from "next/server";
import { DAILY_GOLD_GRANT, ensureProfile } from "@/lib/server/profile-store";
import { dailyGrantFor, streakMultiplier, utcDayKey } from "@/lib/progression/streak";
import { getProgression } from "@/lib/server/progression-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Where the caller stands: rank, XP into the level, lifetime volume, streak.
 *
 * Open to guests, unlike /api/friends and /api/invites. Those address a durable
 * profile id that a guest does not have; a rank is just a readout of play this
 * cookie has already done, and hiding it would mean a guest grinds the arcade
 * with no visible progress at all -- which is the opposite of the point.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "progression:read", 60, 60 * 1000);
  if (limited) return limited;

  try {
    const token = readSessionToken(request);
    if (!token) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

    const profile = await ensureProfile(token);
    const now = new Date();
    const progression = await getProgression(profile.id, now);

    // The claim preview is derived here rather than in the client so the menu
    // and the claim route cannot disagree about tomorrow's number. It is what
    // the *next* claim pays: a streak already claimed today extends by one.
    // One expression covers both cases. A streak already claimed today extends
    // to streak+1 tomorrow; an unclaimed live streak extends to streak+1 today;
    // and a lapsed streak reads 0 through liveStreak, so the max floors it at
    // the fresh-start value of 1.
    const claimedToday = progression.lastClaimDay === utcDayKey(now);
    const nextStreak = Math.max(1, progression.streak + 1);

    return NextResponse.json({
      progression,
      daily: {
        baseGrant: DAILY_GOLD_GRANT,
        claimedToday,
        streak: progression.streak,
        multiplier: streakMultiplier(Math.max(1, progression.streak)),
        nextAmount: dailyGrantFor(DAILY_GOLD_GRANT, nextStreak),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load your progress.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
