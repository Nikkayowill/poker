import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  flipAnteUpMemory,
  resignAnteUpMemoryAttempt,
  toAnteUpMemoryErrorResponse,
} from "@/lib/server/ante-up-memory-service";
import { MEMORY_TILES } from "@/lib/arcade/puzzles/memory";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Acts on the caller's own live Ante Up: Memory Match attempt -- same split
 * as app/api/ante-up/actions/route.ts (Sudoku): `flip` turns a tile over,
 * `resign` gives up early.
 */
const flipSchema = z.object({
  action: z.literal("flip"),
  version: z.number().int().positive(),
  index: z.number().int().min(0).max(MEMORY_TILES - 1),
});

const resignSchema = z.object({ action: z.literal("resign") });

const bodySchema = z.discriminatedUnion("action", [flipSchema, resignSchema]);

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "ante-up-memory:act", 600, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Send a card." }, { status: 400 }),
        token,
      );
    }

    if (parsed.data.action === "flip" && (await isBanned(token))) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const result = parsed.data.action === "resign"
      ? await resignAnteUpMemoryAttempt(token)
      : await flipAnteUpMemory(token, { version: parsed.data.version, index: parsed.data.index });
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toAnteUpMemoryErrorResponse(error), token);
  }
}
