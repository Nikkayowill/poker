import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { bankCoinFlipRun, callCoinFlip } from "@/lib/server/coin-flip-service";
import { toCasinoErrorResponse } from "@/lib/server/casino-round-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Flip, or take the money.
 *
 * `version` matters more here than anywhere else in the arcade, because the
 * pot compounds: a duplicate flip is not a repeated result but a materially
 * different amount of Gold, and a duplicate bank would pay a pot twice.
 * Pinning both to the state the player was looking at is what makes each of
 * them happen exactly once.
 */
const actionSchema = z.object({
  roundId: z.string().uuid(),
  version: z.number().int().positive(),
  move: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("call"), call: z.enum(["heads", "tails"]) }),
    z.object({ kind: z.literal("bank") }),
  ]),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "arcade:coinflip:move", 240, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Call heads or tails, or bank the pot." }, { status: 400 }),
        token,
      );
    }
    const { roundId, version, move } = parsed.data;
    const result =
      move.kind === "call"
        ? await callCoinFlip(token, { roundId, version, call: move.call })
        : await bankCoinFlipRun(token, { roundId, version });
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toCasinoErrorResponse(error), token);
  }
}
