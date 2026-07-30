import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import {
  readOrCreateSessionToken,
  withSessionCookie,
  withSessionPreferenceCookie,
} from "@/lib/server/session";

const bodySchema = z.object({ remember: z.boolean() });

/**
 * Keeps StackChips' HttpOnly gameplay identity aligned with the Supabase
 * browser session. A session cookie (no max-age) expires with the browser;
 * a persistent cookie is retained for returning players.
 *
 * This is the first network call either sign-in method makes, so it is the
 * one legitimate place a first-time visitor's session token gets minted --
 * signing in is exactly the moment an identity needs to exist.
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "auth:session-preference", 10, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid session preference." }, { status: 400 });
  }

  const response = withSessionCookie(
    NextResponse.json({ ok: true }),
    token,
    { persistent: parsed.data.remember },
  );
  return withSessionPreferenceCookie(response, parsed.data.remember);
}
