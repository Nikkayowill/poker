import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withSessionCookie } from "@/lib/server/session";
import { getActiveSeason, getLeaderboard, getPlayerStanding, type LeaderboardScope } from "@/lib/server/stats-store";

export const runtime = "nodejs";

const querySchema = z.object({
  scope: z.enum(["lifetime", "season"]).default("season"),
});

/**
 * Top 10 for the requested scope, the active season's window, and the
 * caller's own standing -- included even when they are well outside the top
 * 10, since "you are #482" is still the number a player came here to check.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "leaderboard:read", 60, 60 * 1000);
  if (limited) return limited;
  try {
    const parsed = querySchema.safeParse({
      scope: request.nextUrl.searchParams.get("scope") ?? undefined,
    });
    if (!parsed.success) return NextResponse.json({ error: "Invalid leaderboard scope." }, { status: 400 });
    const scope: LeaderboardScope = parsed.data.scope;

    const token = readOrCreateSessionToken(request);
    const [profile, entries, season] = await Promise.all([
      ensureProfile(token),
      getLeaderboard(scope, 10),
      getActiveSeason(),
    ]);

    // If the caller is already in the top 10, reuse that row rather than
    // querying again; otherwise fetch their standing and decorate it with the
    // profile we already have in hand, so both branches produce the same
    // shape for the client.
    const inTopTen = entries.find((entry) => entry.profileId === profile.id);
    const mine = inTopTen ?? (await getPlayerStanding(profile.id, scope).then((standing) =>
      standing && standing.rank !== null
        ? {
          ...standing.stats,
          rank: standing.rank,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          accent: profile.accent,
        }
        : null
    ));

    return withSessionCookie(NextResponse.json({ scope, season, entries, mine }), token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the leaderboard.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
