import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dealHiLo, readHiLoRound, toHiLoErrorResponse } from "@/lib/server/hi-lo-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

const dealSchema = z.object({
  tier: z.enum(["1k", "5k", "10k", "25k", "50k", "100k", "250k", "500k"]),
});

/**
 * Hi-Lo.
 *
 * GET restores the caller's live round -- a refresh mid-round must not lose a
 * card they have already paid to see -- and POST deals a new one. Both are
 * thin; the rules, the ordering guarantees and the wallet live in
 * lib/server/hi-lo-service.ts.
 *
 * The browser never receives the deck. What comes back is toHiLoSnapshot()'s
 * redacted view: the face-up card and the quoted odds, never the card that is
 * about to be drawn.
 */
export async function GET(request: NextRequest) {
  const token = readOrCreateSessionToken(request);
  try {
    return withRequestSessionCookie(request, NextResponse.json(await readHiLoRound(token)), token);
  } catch (error) {
    return withRequestSessionCookie(request, toHiLoErrorResponse(error), token);
  }
}

export async function POST(request: NextRequest) {
  // Every accepted call here debits Gold, so this is tighter than the poker
  // table's create limit -- a scripted loop is a wallet-drainer, not noise.
  const limited = enforceRateLimit(request, "arcade:hilo:deal", 60, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = dealSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(request,
        NextResponse.json({ error: "Pick a stake to deal." }, { status: 400 }),
        token,
      );
    }
    if (await isBanned(token)) {
      return withRequestSessionCookie(request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }
    return withRequestSessionCookie(request, NextResponse.json(await dealHiLo(token, parsed.data.tier)), token);
  } catch (error) {
    return withRequestSessionCookie(request, toHiLoErrorResponse(error), token);
  }
}
