import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { withoutSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Ends a sign-in by dropping the session cookie.
 *
 * Signing out of the auth provider only clears state in the browser's own
 * Supabase client; the session cookie is what every gameplay route actually
 * trusts, so it has to go too. The profile itself is left untouched and
 * still linked to the account -- signing back in restores it, while this
 * browser reverts to an ordinary guest.
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "auth:signout", 30, 60 * 1000);
  if (limited) return limited;
  return withoutSessionCookie(NextResponse.json({ ok: true }));
}
