import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { applyPlayerAction, toSnapshot } from "@/lib/game/engine";
import { loadGameWithTimeouts, persistenceMode, updateStoredGame } from "@/lib/server/game-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fold") }),
  z.object({ type: z.literal("check") }),
  z.object({ type: z.literal("call") }),
  z.object({ type: z.literal("raise"), amount: z.number().int().positive() }),
  z.object({ type: z.literal("all-in") }),
  z.object({ type: z.literal("next-hand") }),
  z.object({ type: z.literal("leave-seat") }),
]);

const paramsSchema = z.object({ id: z.string().uuid() });

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const limited = enforceRateLimit(request, "games:action", 40, 10 * 1000);
  if (limited) return limited;
  try {
    const ownerToken = request.cookies.get("river_session")?.value;
    if (!ownerToken) return NextResponse.json({ error: "Your table session expired." }, { status: 401 });
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid poker action." }, { status: 400 });
    const paramsParsed = paramsSchema.safeParse(await context.params);
    if (!paramsParsed.success) return NextResponse.json({ error: "Table not found." }, { status: 404 });
    const { id } = paramsParsed.data;
    const game = await loadGameWithTimeouts(id);
    if (!game) return NextResponse.json({ error: "Table not found." }, { status: 404 });
    const updated = applyPlayerAction(game, parsed.data, ownerToken);
    await updateStoredGame(updated, parsed.data, ownerToken);
    return NextResponse.json({
      game: toSnapshot(updated, ownerToken),
      persistence: persistenceMode(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "That action could not be completed.";
    const status = message.includes("not seated") ? 403 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
