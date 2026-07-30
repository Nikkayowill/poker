import * as Sentry from "@sentry/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { linkAuthenticatedUser } from "@/lib/server/link-account";
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
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const authError = searchParams.get("error_description") ?? searchParams.get("error");

  if (!code) {
    // console.error alongside Sentry: Vercel's own runtime logs are directly
    // readable without a Sentry read-scoped token, which this deployment
    // doesn't have one of yet.
    console.error("[auth/callback] missing code", {
      origin,
      authError,
      paramKeys: [...searchParams.keys()],
    });
    Sentry.captureMessage("oauth.callback_missing_code", {
      level: "error",
      extra: { origin, authError },
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
    Sentry.captureMessage("oauth.exchange_failed", {
      level: "error",
      extra: { origin, reason: error?.message ?? "no session returned" },
    });
    return NextResponse.redirect(`${origin}/?authError=1`);
  }

  try {
    // exchangeCodeForSession already wrote the Supabase auth cookies via
    // cookies() (next/headers), which a Route Handler applies to the
    // response regardless of which NextResponse instance is returned.
    // Only StackChips' own gameplay-identity cookie needs adding here.
    const result = await linkAuthenticatedUser(data.session.user.id, request);
    return withRequestSessionCookie(request, NextResponse.redirect(origin), result.token);
  } catch (linkError) {
    console.error("[auth/callback] linkAuthenticatedUser failed", linkError);
    Sentry.captureException(linkError, { extra: { origin, stage: "link_account" } });
    return NextResponse.redirect(`${origin}/?authError=1`);
  }
}
