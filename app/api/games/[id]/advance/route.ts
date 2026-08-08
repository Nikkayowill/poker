import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toSnapshot } from "@/lib/game/engine";
import {
  advanceStoredGameWithTimeouts,
  getStoredGame,
  persistenceMode,
} from "@/lib/server/game-store";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const limited = enforceRateLimit(request, "games:advance", 120, 60 * 1000);
  if (limited) return limited;

  try {
    const ownerToken = request.cookies.get("river_session")?.value;
    if (!ownerToken) {
      return NextResponse.json({ error: "Your table session expired." }, { status: 401 });
    }
    if (await isBanned(ownerToken)) {
      return NextResponse.json({ error: "Your account has been suspended." }, { status: 403 });
    }

    const paramsParsed = paramsSchema.safeParse(await context.params);
    if (!paramsParsed.success) {
      return NextResponse.json({ error: "Table not found." }, { status: 404 });
    }

    const game = await getStoredGame(paramsParsed.data.id);
    if (!game) return NextResponse.json({ error: "Table not found." }, { status: 404 });
    if (!game.seats.some((seat) => seat.ownerToken === ownerToken)) {
      return NextResponse.json(
        { error: "Only a seated player can advance the table clock." },
        { status: 403 },
      );
    }

    const advanced = await advanceStoredGameWithTimeouts(game);
    const deadline = Date.parse(advanced.turnDeadlineAt ?? "");
    const retryAfterMs = Number.isFinite(deadline)
      ? Math.max(0, deadline - Date.now())
      : null;

    return NextResponse.json({
      game: toSnapshot(advanced, ownerToken),
      persistence: persistenceMode(),
      retryAfterMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not advance the table.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
