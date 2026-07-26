import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createGame, toSnapshot } from "@/lib/game/engine";
import { createStoredGame, persistenceMode } from "@/lib/server/game-store";
import { ensureProfile, updateProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(18).optional(),
  isPrivate: z.boolean().optional(),
});

/** Hosts a brand-new table: "Host Private Game" (isPrivate: true), or a fresh public table. */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "games:create", 10, 5 * 60 * 1000);
  if (limited) return limited;
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a name between 1 and 18 characters." }, { status: 400 });
    }
    const hostToken = readOrCreateSessionToken(request);
    let profile = await ensureProfile(hostToken, parsed.data.name);
    if (parsed.data.name && parsed.data.name !== profile.displayName) {
      profile = await updateProfile(hostToken, {
        displayName: parsed.data.name,
        avatarPreset: profile.avatarPreset,
        accent: profile.accent,
      });
    }
    const game = createGame(hostToken, profile.displayName, profile, { isPrivate: parsed.data.isPrivate });
    await createStoredGame(game);
    const response = NextResponse.json({
      game: toSnapshot(game, hostToken),
      persistence: persistenceMode(),
    });
    return withSessionCookie(response, hostToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the table.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
