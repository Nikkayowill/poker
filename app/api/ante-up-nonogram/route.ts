import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  openAnteUpNonogram,
  readAnteUpNonogram,
  toAnteUpNonogramErrorResponse,
} from "@/lib/server/ante-up-nonogram-service";
import { MIN_ANTE_UP_WAGER } from "@/lib/arcade/ante-up-nonogram";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/** Ante Up: Nonogram's lobby. Same shape as app/api/ante-up-minesweeper/route.ts. */
const startSchema = z.object({
  difficulty: z.string().min(1).max(20),
  wager: z.number().int().min(0),
  /** Off is the paper experience: cross your own finished lines. Defaults on. */
  autoCross: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const token = readOrCreateSessionToken(request);
  try {
    return withRequestSessionCookie(
      request,
      NextResponse.json(await readAnteUpNonogram(token)),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toAnteUpNonogramErrorResponse(error), token);
  }
}

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "ante-up-nonogram:start", 30, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = startSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json(
          { error: `Pick a size, and wager 0 or at least ${MIN_ANTE_UP_WAGER.toLocaleString()}.` },
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

    const result = await openAnteUpNonogram(token, parsed.data.difficulty, parsed.data.wager, {
      autoCross: parsed.data.autoCross,
    });
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toAnteUpNonogramErrorResponse(error), token);
  }
}
