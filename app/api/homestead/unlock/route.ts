import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  homesteadAccessCode,
  isHomesteadCode,
  requestHasHomesteadPass,
  withHomesteadPassCookie,
} from "@/lib/server/homestead-access";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

/**
 * Trades the access code for a pass cookie.
 *
 * THE RATE LIMIT IS THE SECURITY, not the code's length. A code short enough
 * to say out loud is short enough to brute force at HTTP speed, and what these
 * routes protect moves real Gold. 8 attempts per 10 minutes per caller: enough
 * to fat-finger it a few times, nowhere near enough to search a keyspace.
 *
 * It runs BEFORE anything else here, including the already-unlocked shortcut,
 * for the reason the read route's own comment gives -- a check that costs
 * work must never sit in front of the limiter, or a flood gets an amplifier.
 *
 * Deliberately not behind the session cookie: the pass says nothing about who
 * you are, only that you were told the word, so a guest can unlock and play
 * exactly as a registered player can. That matches how the game already
 * treats guests everywhere else.
 */
const bodySchema = z.object({ code: z.string().min(1).max(200) });

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "homestead:unlock", 8, 10 * 60 * 1000);
  if (limited) return limited;

  // No code configured means the door is shut for everyone, including whoever
  // is holding a pass from a previous code. Answered the same as a wrong code
  // on purpose: "there is no code today" and "that is not the code" are the
  // same fact from outside, and distinguishing them tells a prober which
  // deployments are worth attacking.
  if (!homesteadAccessCode()) {
    return NextResponse.json({ error: "That code did not work." }, { status: 401 });
  }

  if (requestHasHomesteadPass(request)) {
    return NextResponse.json({ ok: true });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || !isHomesteadCode(parsed.data.code.trim())) {
    return NextResponse.json({ error: "That code did not work." }, { status: 401 });
  }

  return withHomesteadPassCookie(NextResponse.json({ ok: true }));
}
