import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/server/admin-auth";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { rolloverSeasonIfDue } from "@/lib/server/stats-store";

export const runtime = "nodejs";

/**
 * Closes the active season once its 30-day window has passed, archives its
 * top 10, and opens the next one. Scheduled in vercel.json to run daily;
 * safe to call more often than that or by hand, since rollover_season is a
 * no-op whenever nothing is due -- there is no "already ran today" state to
 * get out of sync.
 */
export async function GET(request: NextRequest) {
  // Same posture as the other cron routes: a tight per-IP cap, purely to
  // blunt a flood of guesses at CRON_SECRET.
  const limited = enforceRateLimit(request, "cron:rollover-season", 10, 60 * 1000);
  if (limited) return limited;

  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  try {
    const closedSeasonId = await rolloverSeasonIfDue();
    return NextResponse.json({ rolledOver: closedSeasonId !== null, closedSeasonId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not roll over the season.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
