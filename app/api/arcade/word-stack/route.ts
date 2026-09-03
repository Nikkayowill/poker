import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readWordStackPuzzle, startWordStackPuzzle, toWordStackErrorResponse } from "@/lib/server/word-stack-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `wager` is optional and defaults to 0 (free); an empty POST body is still a
 * valid open. `day` is optional and defaults to today; passed by the puzzle
 * archive to open a past day instead -- the service enforces that it is
 * free-only and within [PUZZLE_EPOCH_DAY, today].
 */
const startSchema = z.object({ wager: z.number().int().min(0).optional(), day: z.string().regex(DAY_PATTERN).optional() });

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
 *
 * An optional `?day=` reads an archive day instead of today's -- the puzzle
 * archive page uses this to load a day it already opened without reopening
 * it, the same read-never-writes rule as the no-day path.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "arcade:word-stack:read", 120, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  const dayParam = request.nextUrl.searchParams.get("day");
  if (dayParam && !DAY_PATTERN.test(dayParam)) {
    return withRequestSessionCookie(
      request,
      NextResponse.json({ error: "That is not a puzzle day." }, { status: 400 }),
      token,
    );
  }
  try {
    return withRequestSessionCookie(
      request,
      NextResponse.json(await readWordStackPuzzle(token, dayParam ?? undefined)),
      token,
    );
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
      NextResponse.json(await startWordStackPuzzle(token, parsed.data.wager ?? 0, parsed.data.day)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toWordStackErrorResponse(error), token);
  }
}
