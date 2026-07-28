import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ensureProfile, findSessionByUserId, linkProfileToUser } from "@/lib/server/profile-store";
import { persistenceMode } from "@/lib/server/game-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";
import { readSupabaseRuntimeConfig } from "@/lib/server/runtime-config";

export const runtime = "nodejs";

const bodySchema = z.object({
  accessToken: z.string().min(1),
});

/**
 * Turns a signed-in browser into a registered profile.
 *
 * The access token is verified against Supabase rather than trusted, so a
 * caller cannot claim to be an account by asserting its id. Everything else
 * keys off the account id we get back from that verification.
 *
 * Two outcomes, both of which end with this browser holding a session cookie
 * for the right profile:
 *   - the account already owns a profile -> restore it (a returning player
 *     on a new device, or one whose cookie was cleared)
 *   - it doesn't -> link the profile this browser is already using, so a
 *     guest keeps the Gold and avatar they just earned
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "auth:link", 20, 60 * 1000);
  if (limited) return limited;

  const config = readSupabaseRuntimeConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Accounts are unavailable in local demo mode." },
      { status: 503 },
    );
  }

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Sign-in could not be verified." }, { status: 400 });
    }

    // Verified against Supabase with the public key: this call is what proves
    // the caller actually holds a valid session for the account it names.
    const auth = createClient(config.url, config.publicKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await auth.auth.getUser(parsed.data.accessToken);
    if (error || !data.user) {
      return NextResponse.json({ error: "Sign-in could not be verified." }, { status: 401 });
    }
    const userId = data.user.id;

    const existing = await findSessionByUserId(userId);
    if (existing) {
      // Restore. Any Gold on the guest profile this browser was using is
      // deliberately left behind rather than merged: merging balances across
      // sessions is exactly the mechanic that makes multi-accounting pay.
      return withRequestSessionCookie(request,
        NextResponse.json({ profile: existing.profile, restored: true, persistence: persistenceMode() }),
        existing.token,
      );
    }

    const token = readOrCreateSessionToken(request);
    await ensureProfile(token);
    const profile = await linkProfileToUser(token, userId);
    return withRequestSessionCookie(request,
      NextResponse.json({ profile, restored: false, persistence: persistenceMode() }),
      token,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save your progress.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
