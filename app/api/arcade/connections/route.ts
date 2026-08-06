import { NextRequest, NextResponse } from "next/server";
import {
  readConnectionsPuzzle,
  startConnectionsPuzzle,
  toConnectionsErrorResponse,
} from "@/lib/server/connections-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Connections.
 *
 * GET reads today's board and never opens one; POST opens it and is idempotent
 * for the day, resuming rather than re-dealing even after the board is
 * finished. Same contract as the Wordle route.
 *
 * The browser never receives the groups. toConnectionsSnapshot sends the words
 * still on the board plus the groups already solved, and withholds both the
 * unsolved groupings and the per-word colour matrix until the round is over --
 * the latter matters because releasing it early would turn four wrong guesses
 * into a complete solution.
 */
export async function GET(request: NextRequest) {
  const token = readOrCreateSessionToken(request);
  try {
    return withRequestSessionCookie(
      request,
      NextResponse.json(await readConnectionsPuzzle(token)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toConnectionsErrorResponse(error), token);
  }
}

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "arcade:connections:start", 60, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    if (await isBanned(token)) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }
    return withRequestSessionCookie(
      request,
      NextResponse.json(await startConnectionsPuzzle(token)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toConnectionsErrorResponse(error), token);
  }
}
