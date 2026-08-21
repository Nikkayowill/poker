import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  openAnteUpWordStack,
  readAnteUpWordStack,
  toAnteUpWordStackErrorResponse,
} from "@/lib/server/ante-up-word-stack-service";
import { MIN_ANTE_UP_WAGER } from "@/lib/arcade/ante-up-word-stack";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Ante Up: Word Stack's lobby. Same shape as app/api/ante-up/route.ts
 * (Sudoku) minus the difficulty pick -- see lib/arcade/ante-up-word-stack.ts.
 */
const startSchema = z.object({
  wager: z.number().int().min(0),
});

export async function GET(request: NextRequest) {
  const token = readOrCreateSessionToken(request);
  try {
    return withRequestSessionCookie(request, NextResponse.json(await readAnteUpWordStack(token)), token);
  } catch (error) {
    return withRequestSessionCookie(request, toAnteUpWordStackErrorResponse(error), token);
  }
}

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "ante-up-word-stack:start", 30, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = startSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json(
          { error: `Wager 0 or at least ${MIN_ANTE_UP_WAGER.toLocaleString()}.` },
          { status: 400 },
        ),
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

    const result = await openAnteUpWordStack(token, parsed.data.wager);
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toAnteUpWordStackErrorResponse(error), token);
  }
}
