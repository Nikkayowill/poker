import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toSnapshot } from "@/lib/game/engine";
import { loadGameWithTimeouts, persistenceMode } from "@/lib/server/game-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const limited = enforceRateLimit(request, "games:read", 180, 60 * 1000);
  if (limited) return limited;
  try {
    const paramsParsed = paramsSchema.safeParse(await context.params);
    if (!paramsParsed.success) return NextResponse.json({ error: "Table not found." }, { status: 404 });
    const { id } = paramsParsed.data;
    const game = await loadGameWithTimeouts(id);
    if (!game) return NextResponse.json({ error: "Table not found." }, { status: 404 });
    const ownerToken = request.cookies.get("river_session")?.value ?? "";
    if (
      game.isPrivate
      && !game.seats.some((seat) => seat.ownerToken === ownerToken)
    ) {
      return NextResponse.json(
        { error: "Join this private table with its invite code first." },
        { status: 403 },
      );
    }
    return NextResponse.json({
      game: toSnapshot(game, ownerToken),
      persistence: persistenceMode(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the table.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
