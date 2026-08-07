import { NextRequest, NextResponse } from "next/server";
import { dailyGrantFor } from "@/lib/progression/streak";
import { claimDailyGold, DAILY_GOLD_GRANT, ensureProfile } from "@/lib/server/profile-store";
import { persistenceMode } from "@/lib/server/game-store";
import { getProgression, recordDailyClaim } from "@/lib/server/progression-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "profile:gold:claim", 10, 60 * 1000);
  if (limited) return limited;
  try {
    const token = request.cookies.get("river_session")?.value;
    if (!token) return NextResponse.json({ error: "Your profile session expired." }, { status: 401 });

    // Resolved before the streak is touched. claimDailyGold refuses a guest
    // outright, and recording a streak for a claim that is about to be refused
    // would leave a row nobody earned -- and, worse, would let a guest build a
    // multiplier they can never spend.
    const profile = await ensureProfile(token);
    if (!profile.isRegistered) {
      return NextResponse.json(
        { error: "Save your progress to claim daily Gold." },
        { status: 403 },
      );
    }

    // Streak first, then the credit. Safe in that order because recording is
    // idempotent for the day (streakAfterClaim returns the streak unchanged
    // when today is already recorded) while the credit is not -- and the
    // once-per-day guard inside claim_daily_gold is what actually stops a
    // second claim. Reversed, a process dying between the two would pay the
    // multiplier without recording the day that earned it.
    const streak = await recordDailyClaim(profile.id);
    const amount = dailyGrantFor(DAILY_GOLD_GRANT, streak);

    const credited = await claimDailyGold(token, amount);
    return NextResponse.json({
      profile: credited,
      persistence: persistenceMode(),
      // What the player just earned and where it leaves them, so the menu can
      // say "day 4 · x1.75" instead of only showing a number going up.
      claim: { amount, streak, baseGrant: DAILY_GOLD_GRANT },
      progression: await getProgression(profile.id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not claim your daily Gold.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
