import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { flipMemory, toMemoryErrorResponse } from "@/lib/server/memory-service";
import { MEMORY_TILES } from "@/lib/arcade/puzzles/memory";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Turn one tile over.
 *
 * A request per tap, because the card underneath is the secret -- the server
 * is the only thing that knows what is there, and it reveals exactly the one
 * tile that was tapped.
 *
 * `version` stops a double-fired tap burning two turns on one card, which in a
 * game scored on turns is the difference between a good board and a ruined
 * one.
 */
const actionSchema = z.object({
  version: z.number().int().positive(),
  index: z.number().int().min(0).max(MEMORY_TILES - 1),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "arcade:memory:flip", 300, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Pick a card to turn over." }, { status: 400 }),
        token,
      );
    }
    return withRequestSessionCookie(request, NextResponse.json(await flipMemory(token, parsed.data)), token);
  } catch (error) {
    return withRequestSessionCookie(request, toMemoryErrorResponse(error), token);
  }
}
