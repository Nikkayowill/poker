import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { leaderboardGame } from "@/lib/leaderboard/contract";
import { getGameLeaderboard, getGameStanding, getGlobalLeaderboard, getGlobalStanding } from "@/lib/server/leaderboard-store";
import { ensureProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";
import { getActiveSeason, getLeaderboard, getPlayerStanding, type LeaderboardScope } from "@/lib/server/stats-store";

export const runtime = "nodejs";

const querySchema = z.object({
  scope: z.enum(["lifetime", "season"]).default("season"),
  game: z.string().default("poker"),
});

/**
 * Top 10, and the caller's own standing even when they are well outside it
 * -- "you are #482" is still the number a player came here to check.
 *
 * `game=poker` (the default) is the original poker leaderboard, byte-for-
 * byte unchanged, `scope` meaningful only here. `game=global` is the
 * percentile blend across every game a player qualifies in. Any other known
 * id (see lib/leaderboard/contract.ts's registry) is that game's own
 * win/loss or average-metric board, with pre-formatted `cells` a client
 * renders without knowing the game's shape -- this is what lets a future
 * game join with no UI change.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "leaderboard:read", 60, 60 * 1000);
  if (limited) return limited;
  try {
    const parsed = querySchema.safeParse({
      scope: request.nextUrl.searchParams.get("scope") ?? undefined,
      game: request.nextUrl.searchParams.get("game") ?? undefined,
    });
    if (!parsed.success) return NextResponse.json({ error: "Invalid leaderboard request." }, { status: 400 });
    const { scope, game } = parsed.data as { scope: LeaderboardScope; game: string };

    // Reading the board is anonymous-safe: someone with no session simply has
    // no standing of their own. Creating a profile just to answer "you are
    // unranked" would fill the roster with players who never sat down.
    const token = readSessionToken(request);
    const profile = token ? await ensureProfile(token) : null;

    if (game === "global") {
      const [entries, mine] = await Promise.all([
        getGlobalLeaderboard(10),
        profile ? getGlobalStanding(profile.id) : Promise.resolve(null),
      ]);
      return NextResponse.json({ game, entries, mine });
    }

    if (game !== "poker") {
      const contract = leaderboardGame(game);
      if (!contract) return NextResponse.json({ error: "Unknown leaderboard." }, { status: 400 });
      const [entries, mine] = await Promise.all([
        getGameLeaderboard(game, 10),
        profile ? getGameStanding(game, profile.id) : Promise.resolve(null),
      ]);
      return NextResponse.json({ game, label: contract.label, columns: contract.columns, entries, mine });
    }

    const [entries, season] = await Promise.all([
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

    return NextResponse.json({ game: "poker", scope, season, entries, mine });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the leaderboard.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
