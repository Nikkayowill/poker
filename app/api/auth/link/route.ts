import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { linkAuthenticatedUser, linkResultResponse } from "@/lib/server/link-account";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Called after email/password sign-in completes client-side. Google sign-in
 * does not use this route -- the OAuth callback route handler links inline,
 * since it already holds a freshly authenticated server client from the
 * code exchange.
 *
 * No token in the request body: the Supabase session now lives in a cookie
 * (@supabase/ssr), so getUser() reads it directly and verifies it against
 * Supabase itself, rather than trusting anything the caller asserts.
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "auth:link", 20, 60 * 1000);
  if (limited) return limited;

  const supabase = await createServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Accounts are unavailable in local demo mode." },
      { status: 503 },
    );
  }

  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return NextResponse.json({ error: "Sign-in could not be verified." }, { status: 401 });
    }

    const result = await linkAuthenticatedUser(data.user.id, request);
    return linkResultResponse(request, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save your progress.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
