import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { applyPlayerAction, toSnapshot } from "@/lib/game/engine";
import { clampBuyIn } from "@/lib/game/tiers";
import { loadGameWithTimeouts, persistenceMode, updateStoredGame } from "@/lib/server/game-store";
import { creditGold, spendGold } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import type { PlayerProfile } from "@/lib/profile/types";

export const runtime = "nodejs";

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fold") }),
  z.object({ type: z.literal("check") }),
  z.object({ type: z.literal("call") }),
  z.object({ type: z.literal("raise"), amount: z.number().int().positive() }),
  z.object({ type: z.literal("all-in") }),
  z.object({ type: z.literal("use-time-card") }),
  z.object({ type: z.literal("next-hand") }),
  z.object({ type: z.literal("leave-seat") }),
  z.object({ type: z.literal("rebuy"), amount: z.number().int().positive() }),
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

    let action = parsed.data;
    let goldSpent = 0;
    let profile: PlayerProfile | undefined;
    if (action.type === "rebuy") {
      const seat = game.seats.find((candidate) => candidate.ownerToken === ownerToken);
      if (!seat) return NextResponse.json({ error: "You are not seated at this table." }, { status: 403 });
      if (game.status !== "complete") {
        return NextResponse.json({ error: "You can only rebuy between hands." }, { status: 409 });
      }
      if (seat.stack > 0) {
        return NextResponse.json({ error: "Your seat still has chips." }, { status: 409 });
      }
      const clamped = clampBuyIn(game.tier, action.amount);
      profile = await spendGold(ownerToken, clamped);
      goldSpent = clamped;
      action = { type: "rebuy", amount: clamped };
    }

    try {
      const updated = applyPlayerAction(game, action, ownerToken);
      await updateStoredGame(updated, action, ownerToken);
      return NextResponse.json({
        game: toSnapshot(updated, ownerToken),
        persistence: persistenceMode(),
        ...(profile ? { profile } : {}),
      });
    } catch (applyError) {
      // The rebuy's Gold was already spent; a failure applying or persisting
      // the state transition means the player got nothing for it, so make
      // them whole rather than leaving a silent, unrecoverable loss.
      if (goldSpent > 0) {
        profile = await creditGold(ownerToken, goldSpent).catch(() => profile);
      }
      throw applyError;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "That action could not be completed.";
    const status = message.includes("not seated") ? 403 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
