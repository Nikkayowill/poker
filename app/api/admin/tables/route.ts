import { NextRequest, NextResponse } from "next/server";
import { archiveStaleGames, countActiveGames } from "@/lib/server/game-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { isAdminAuthorized } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "admin:tables", 20, 60 * 1000);
  if (limited) return limited;
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const counts = await countActiveGames();
    return NextResponse.json(counts);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not count active tables.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * Manually drains the stale-table backlog rather than waiting for ordinary
 * matchmaking traffic to work through it a batch at a time (see
 * archiveStaleGames's own comment) -- meant for a one-off cleanup, not a
 * cron this app doesn't have. Loops the bounded sweep itself so one call can
 * actually clear a backlog instead of returning the same small batch size
 * the organic path uses; capped at MAX_SWEEP_ROUNDS so a very large backlog
 * still returns promptly rather than holding the request open indefinitely.
 */
const MAX_SWEEP_ROUNDS = 40;

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "admin:tables:sweep", 5, 60 * 1000);
  if (limited) return limited;
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    let total = 0;
    for (let round = 0; round < MAX_SWEEP_ROUNDS; round += 1) {
      const archived = await archiveStaleGames();
      total += archived;
      if (archived === 0) break;
    }
    return NextResponse.json({ archived: total });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not sweep stale tables.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
