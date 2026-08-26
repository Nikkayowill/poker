import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readWordStackPuzzle, startWordStackPuzzle, toWordStackErrorResponse } from "@/lib/server/word-stack-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

/** `wager` is optional and defaults to 0 (free); an empty POST body is still a valid open. */
const startSchema = z.object({ wager: z.number().int().min(0).optional() });

export const runtime = "nodejs";

/**
 * Daily Word Stack.
 *
 * GET reads today's board and never opens one; visiting a page must not be
 * the same thing as starting a puzzle. POST opens it, and is idempotent for
 * the day: a second POST resumes rather than re-deals, including after the
 * board is finished.
 *
 * The browser never receives the answer while the round is live. What comes
 * back is toWordStackSnapshot()'s redacted view: the tiles it has already
 * earned, and `answer: null` until the puzzle is over. A five-letter string in
 * this payload would be a one-guess win for anyone with a network tab open,
 * which is the first thing a curious player tries.
 *
 * No registration gate: the puzzles are free, so this follows the arcade's
 * session-token pattern rather than /api/history's registered-only split. A
 * guest's board is keyed to their cookie-lived profile, the honest trade:
 * they keep their streak exactly as long as they keep the cookie.
 */
export async function GET(request: NextRequest) {
  const token = readOrCreateSessionToken(request);
  try {
    return withRequestSessionCookie(request, NextResponse.json(await readWordStackPuzzle(token)), token);
  } catch (error) {
    return withRequestSessionCookie(request, toWordStackErrorResponse(error), token);
  }
}

export async function POST(request: NextRequest) {
  // Looser than the casino deal limits: nothing here spends Gold, and the
  // unique index means a scripted loop gets the same board back rather than
  // consuming anything. This is noise control, not a wallet guard.
  const limited = enforceRateLimit(request, "arcade:word-stack:start", 60, 60 * 1000);
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
    const parsed = startSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "That is not a wager." }, { status: 400 }),
        token,
      );
    }
    return withRequestSessionCookie(
      request,
      NextResponse.json(await startWordStackPuzzle(token, parsed.data.wager ?? 0)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toWordStackErrorResponse(error), token);
  }
}
