import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/server/admin-auth";
import { pruneGameActions } from "@/lib/server/game-store";

export const runtime = "nodejs";

/**
 * Deletes game_actions rows past the 30-day retention window, in bounded
 * batches (see prune_game_actions in the migration for why). Scheduled in
 * vercel.json to run daily; safe to call more often or by hand -- an empty
 * table just returns { deleted: 0 }.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  try {
    const result = await pruneGameActions();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prune game_actions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
