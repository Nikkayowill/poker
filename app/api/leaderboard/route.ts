import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getFriendsRankBoard, getGlobalRankBoard } from "@/lib/server/rank-board-store";
import { ensureProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";
import { publicErrorMessage } from "@/lib/server/public-error";

export const runtime = "nodejs";

const querySchema = z.object({
  game: z.enum(["global", "friends"]).default("global"),
});

/**
 * Two boards, both ranked by rank points from solo wagers:
 * `game=global` is the top 10 plus the caller's own row when they are outside
 * it, and `game=friends` is the caller and their friends ranked among
 * themselves. Neither carries win/loss counters.
 */
export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, "leaderboard:read", 60, 60 * 1000);
  if (limited) return limited;
  try {
    const parsed = querySchema.safeParse({ game: request.nextUrl.searchParams.get("game") ?? undefined });
    if (!parsed.success) return NextResponse.json({ error: "Invalid leaderboard request." }, { status: 400 });
    const { game } = parsed.data;

    // Reading the board is anonymous-safe: someone with no session simply has
    // no standing of their own. Creating a profile just to answer "you are
    // unranked" would fill the roster with players who never sat down.
    const token = readSessionToken(request);
    const profile = token ? await ensureProfile(token) : null;

    if (game === "friends") {
      // A guest has no durable identity to hold friends under. Answered as an
      // empty board with a reason rather than a 401.
      if (!profile) return NextResponse.json({ game, entries: [], requiresAccount: true });
      return NextResponse.json({ game, entries: await getFriendsRankBoard(profile.id) });
    }

    const { entries, mine } = await getGlobalRankBoard(10, profile?.id ?? null);
    return NextResponse.json({ game, entries, mine });
  } catch (error) {
    const message = publicErrorMessage(error, "Could not load the leaderboard.");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
