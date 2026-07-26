import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { claimSeat, createGame, toSnapshot } from "@/lib/game/engine";
import {
  createStoredGame,
  findOpenPublicGame,
  getStoredGame,
  persistenceMode,
  persistSeatClaim,
} from "@/lib/server/game-store";
import { ensureProfile, updateProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(18).optional(),
});

// A handful of attempts absorbs the rare case where another quick-play
// request claims the same open seat first; each retry re-queries for a
// still-open table rather than assuming the original one is still viable.
const MAX_CLAIM_ATTEMPTS = 4;

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "games:quick-play", 10, 60 * 1000);
  if (limited) return limited;
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a name between 1 and 18 characters." }, { status: 400 });
    }
    const token = readOrCreateSessionToken(request);
    let profile = await ensureProfile(token, parsed.data.name);
    if (parsed.data.name && parsed.data.name !== profile.displayName) {
      profile = await updateProfile(token, {
        displayName: parsed.data.name,
        avatarPreset: profile.avatarPreset,
        accent: profile.accent,
      });
    }

    let joined = null;
    for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS && !joined; attempt += 1) {
      const openGameId = await findOpenPublicGame();
      if (!openGameId) break;
      const loaded = await getStoredGame(openGameId);
      if (!loaded) continue;
      try {
        const beforeVersion = loaded.version;
        const { state, seatIndex } = claimSeat(loaded, token, profile);
        if (state.version !== beforeVersion) {
          await persistSeatClaim(state, state.seats[seatIndex].id);
        }
        joined = state;
      } catch {
        // Someone else claimed the last open seat, or the table filled between
        // our lookup and our claim; loop around and search again.
      }
    }

    const game = joined ?? await (async () => {
      const created = createGame(token, profile.displayName, profile, { isPrivate: false });
      await createStoredGame(created);
      return created;
    })();

    const response = NextResponse.json({
      game: toSnapshot(game, token),
      persistence: persistenceMode(),
    });
    return withSessionCookie(response, token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not find you a table.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
