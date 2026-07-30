import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";
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

    // Reading the board is anonymous-safe: someone with no session simply has
    // no standing of their own. Creating a profile just to answer "you are
    // unranked" would fill the roster with players who never sat down.
    const token = readSessionToken(request);
    const [profile, entries, season] = await Promise.all([
      token ? ensureProfile(token) : Promise.resolve(null),
      getLeaderboard(scope, 10),
      getActiveSeason(),
    ]);

    // If the caller is already in the top 10, reuse that row rather than
    // querying again; otherwise fetch their standing and decorate it with the
    // profile we already have in hand, so both branches produce the same
    // shape for the client.
    const inTopTen = profile ? entries.find((entry) => entry.profileId === profile.id) : undefined;
    const mine = !profile
      ? null
      : inTopTen ?? (await getPlayerStanding(profile.id, scope).then((standing) =>
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

    return NextResponse.json({ scope, season, entries, mine });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the leaderboard.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
