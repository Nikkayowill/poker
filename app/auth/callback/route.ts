import { NextRequest, NextResponse } from "next/server";
import { findRestoreConflict, linkAuthenticatedUser } from "@/lib/server/link-account";
import { withRequestSessionCookie } from "@/lib/server/session";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Exchanges the OAuth authorization code for a session and links the
 * account, entirely server-side, in the single request Supabase redirects
 * the browser to. No client JS is involved in the exchange itself, which is
 * what removes the failure modes the previous client-side callback page
 * existed to work around: a PKCE verifier that could go missing from
 * origin-scoped browser storage, and a duplicate exchange racing a React
 * effect (flow_state_already_used).
 *
 * A code is only usable once. If Supabase's own redirect ever lands here
 * without one, or the exchange fails, that is reported rather than
 * silently bounced -- this route is the one place server-side that can see
 * it happen at all.
 *
 * `?entered=1` on the success redirect is the entry gate's own signal (see
 * `lib/profile/session-continuity.ts`): this round trip leaves the app
 * entirely and comes back as a fresh mount, so the client can't just call
 * `markEntryOpened` from the click handler the way every other entry path
 * does. `?restoreConfirm=1` is the one success case that redirects WITHOUT
 * finishing the link -- see `findRestoreConflict`.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const authError = searchParams.get("error_description") ?? searchParams.get("error");

  if (!code) {
    // Vercel's own runtime logs are where these land: this deployment has no
    // Sentry read-scoped token, and the server SDK no longer ships (see
    // instrumentation-client.ts, the only Sentry entry point left).
    console.error("[auth/callback] missing code", {
      origin,
      authError,
      paramKeys: [...searchParams.keys()],
    });
    return NextResponse.redirect(`${origin}/?authError=1`);
  }

  const supabase = await createServerSupabase();
  if (!supabase) {
    console.error("[auth/callback] no Supabase config on server");
    return NextResponse.redirect(`${origin}/?authError=1`);
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    console.error("[auth/callback] exchangeCodeForSession failed", {
      origin,
      status: error?.status,
      code: error?.code,
      message: error?.message,
    });
    return NextResponse.redirect(`${origin}/?authError=1`);
  }

  try {
    // This browser is mid-guest-run with its own progress, and the Google
    // identity that just authenticated already owns a *different* profile.
    // Finishing the link here would silently discard that guest progress
    // (linkAuthenticatedUser's restore branch), so defer instead of calling
    // it: the Supabase auth session above is already live, so the client's
    // confirm step only has to call POST /api/auth/link, which reads that
    // same cookie. Cancelling there signs the Supabase session back out
    // without ever touching this guest's own profile.
    const restoreCheck = await findRestoreConflict(data.session.user.id, request);
    if (restoreCheck.hasConflict) {
      return NextResponse.redirect(`${origin}/?restoreConfirm=1`);
    }

    // exchangeCodeForSession already wrote the Supabase auth cookies via
    // cookies() (next/headers), which a Route Handler applies to the
    // response regardless of which NextResponse instance is returned.
    // Only StackChips' own gameplay-identity cookie needs adding here.
    // restoreCheck.existing is the same lookup this would otherwise redo.
    const result = await linkAuthenticatedUser(data.session.user.id, request, restoreCheck.existing);
    return withRequestSessionCookie(request, NextResponse.redirect(`${origin}/?entered=1`), result.token);
  } catch (linkError) {
    console.error("[auth/callback] linkAuthenticatedUser failed", linkError);
    return NextResponse.redirect(`${origin}/?authError=1`);
  }
}
