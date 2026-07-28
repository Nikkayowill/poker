import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import {
  readSessionToken,
  withSessionCookie,
  withSessionPreferenceCookie,
} from "@/lib/server/session";

const bodySchema = z.object({ remember: z.boolean() });

/**
 * Keeps River Room's HttpOnly gameplay identity aligned with the Supabase
 * browser session. A session cookie (no max-age) expires with the browser;
 * a persistent cookie is retained for returning players.
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "auth:session-preference", 10, 60 * 1000);
  if (limited) return limited;

  const token = readSessionToken(request);
  if (!token) {
    return NextResponse.json({ error: "Your player session has expired." }, { status: 401 });
  }

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
