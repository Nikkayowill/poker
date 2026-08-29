import * as Sentry from "@sentry/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { linkAuthenticatedUser } from "@/lib/server/link-account";
import { withRequestSessionCookie } from "@/lib/server/session";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * The password-recovery counterpart to app/auth/callback/route.ts, kept as
 * its own route rather than reusing that one because the two must redirect
 * to different places on success: an OAuth/magic-link code means "you're
 * signed in, go to the app," a recovery code means "you're now authenticated
 * *so that* you can set a new password" -- landing this exchange on `/`
 * instead of the reset-password page would silently skip the one step the
 * player asked for, leaving them still not knowing a password that works.
 *
 * linkAuthenticatedUser is still correct to call here: a player resetting a
 * password already has a linked profile, so it takes the "restore existing"
 * branch (see that function's own doc comment) rather than merging anything
 * from this browser's local guest profile, exactly like a normal sign-in.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const authError = searchParams.get("error_description") ?? searchParams.get("error");

  if (!code) {
    console.error("[auth/reset-password/callback] missing code", {
      origin,
      authError,
      paramKeys: [...searchParams.keys()],
    });
    Sentry.captureMessage("password_reset.callback_missing_code", {
      level: "error",
      extra: { origin, authError },
    });
    return NextResponse.redirect(`${origin}/?resetError=1`);
  }

  const supabase = await createServerSupabase();
  if (!supabase) {
    console.error("[auth/reset-password/callback] no Supabase config on server");
    return NextResponse.redirect(`${origin}/?resetError=1`);
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    console.error("[auth/reset-password/callback] exchangeCodeForSession failed", {
      origin,
      status: error?.status,
      code: error?.code,
      message: error?.message,
    });
    Sentry.captureMessage("password_reset.exchange_failed", {
      level: "error",
      extra: { origin, reason: error?.message ?? "no session returned" },
    });
    return NextResponse.redirect(`${origin}/?resetError=1`);
  }

  try {
    const result = await linkAuthenticatedUser(data.session.user.id, request);
    return withRequestSessionCookie(
      request,
      NextResponse.redirect(`${origin}/auth/reset-password`),
      result.token,
    );
  } catch (linkError) {
    console.error("[auth/reset-password/callback] linkAuthenticatedUser failed", linkError);
    Sentry.captureException(linkError, { extra: { origin, stage: "link_account" } });
    return NextResponse.redirect(`${origin}/?resetError=1`);
  }
}
