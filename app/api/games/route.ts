import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createGame, toSnapshot } from "@/lib/game/engine";
import { createStoredGame, persistenceMode } from "@/lib/server/game-store";
import { ensureProfile, updateProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(18).optional(),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "games:create", 10, 5 * 60 * 1000);
  if (limited) return limited;
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a name between 1 and 18 characters." }, { status: 400 });
    }
    const ownerToken = request.cookies.get("river_session")?.value ?? randomUUID();
    let profile = await ensureProfile(ownerToken, parsed.data.name);
    if (parsed.data.name && parsed.data.name !== profile.displayName) {
      profile = await updateProfile(ownerToken, {
        displayName: parsed.data.name,
        avatarPreset: profile.avatarPreset,
        accent: profile.accent,
      });
    }
    const game = createGame(ownerToken, profile.displayName, profile);
    await createStoredGame(game);
    const response = NextResponse.json({
      game: toSnapshot(game, ownerToken),
      persistence: persistenceMode(),
    });
    response.cookies.set("river_session", ownerToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the table.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
