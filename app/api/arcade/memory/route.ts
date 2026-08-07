import { NextRequest, NextResponse } from "next/server";
import { readMemoryRound, startMemory, toMemoryErrorResponse } from "@/lib/server/memory-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Memory Match.
 *
 * GET reads the caller's attempt at today's board and POST deals one. There is
 * nothing to choose, so POST takes no body.
 *
 * The browser never receives the layout: every face-down tile comes back as
 * `null`, not as a card marked hidden. A client holding the board would clear
 * it in eight turns, and the turn count is the whole score.
 */
export async function GET(request: NextRequest) {
  const token = readOrCreateSessionToken(request);
  try {
    return withRequestSessionCookie(request, NextResponse.json(await readMemoryRound(token)), token);
  } catch (error) {
    return withRequestSessionCookie(request, toMemoryErrorResponse(error), token);
  }
}

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "arcade:memory:start", 30, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    return withRequestSessionCookie(request, NextResponse.json(await startMemory(token)), token);
  } catch (error) {
    return withRequestSessionCookie(request, toMemoryErrorResponse(error), token);
  }
}
