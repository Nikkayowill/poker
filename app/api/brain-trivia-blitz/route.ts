import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  openBrainTriviaBlitz,
  readBrainTriviaBlitz,
  toBrainTriviaBlitzErrorResponse,
} from "@/lib/server/brain-trivia-blitz-service";
import { MIN_ANTE_UP_WAGER } from "@/lib/arcade/brain-streak";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

const startSchema = z.object({ wager: z.number().int().min(0) });

export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, "brain-trivia-blitz:read", 120, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    return withRequestSessionCookie(request, NextResponse.json(await readBrainTriviaBlitz(token)), token);
  } catch (error) {
    return withRequestSessionCookie(request, toBrainTriviaBlitzErrorResponse(error), token);
  }
}

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "brain-trivia-blitz:start", 30, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = startSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: `Wager 0 or at least ${MIN_ANTE_UP_WAGER.toLocaleString()}.` }, { status: 400 }),
        token,
      );
    }
    if (parsed.data.wager > 0 && (await isBanned(token))) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const result = await openBrainTriviaBlitz(token, parsed.data.wager);
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toBrainTriviaBlitzErrorResponse(error), token);
  }
}
