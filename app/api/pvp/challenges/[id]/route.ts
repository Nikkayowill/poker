import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  acceptDuelChallenge,
  cancelDuelChallenge,
  toDuelErrorResponse,
} from "@/lib/server/pvp-match-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Settling one challenge: accept it, or withdraw your own.
 *
 * Both move Gold. Accepting DEBITS the caller and opens the match; cancelling
 * REFUNDS the caller's escrow. Each goes through a status-guarded write that
 * can succeed at most once, which is what makes a double-tapped Accept pay one
 * stake and a double-tapped Cancel refund one -- see the ordering rules in
 * lib/server/pvp-match-service.ts.
 *
 * No game in the path: a challenge id already names its game, and taking one
 * from the caller would let a request address a challenge under the wrong
 * engine.
 */
const actionSchema = z.object({
  action: z.enum(["accept", "cancel"]),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const limited = enforceRateLimit(request, "pvp:challenge:respond", 60, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const { id } = await context.params;
    const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Accept or cancel." }, { status: 400 }),
        token,
      );
    }

    if (parsed.data.action === "cancel") {
      const result = await cancelDuelChallenge(token, id);
      return withRequestSessionCookie(request, NextResponse.json(result), token);
    }

    // Only the accept path is ban-gated: withdrawing your own escrow is
    // getting your Gold back, and a suspended account must still be able to.
    if (await isBanned(token)) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }
    const result = await acceptDuelChallenge(token, id);
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toDuelErrorResponse(error), token);
  }
}
