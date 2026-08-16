import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isCrossOriginMutation } from "@/lib/server/request-origin";
import { readSupabasePublicKey, readSupabaseUrl } from "@/lib/supabase/public-env";

/**
 * Refreshes the Supabase auth cookie before it expires.
 *
 * getUser() (not getSession()) is what actually contacts Supabase and
 * rewrites the cookie with a refreshed token when the current one is close
 * to expiry. Route Handlers and Server Components can read cookies but a
 * Server Component can't write them, so without this running first on every
 * request, a session would silently go stale for any player who only ever
 * renders Server Components.
 */
export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/") && isCrossOriginMutation(request)) {
    return NextResponse.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  let response = NextResponse.next({ request });
  if (
    request.nextUrl.pathname.startsWith("/api/")
    || request.nextUrl.pathname === "/auth/callback"
  ) {
    // Snapshots contain caller-filtered hole cards and every API may receive
    // an ambient credential. Never let a browser or shared intermediary reuse
    // one caller's response for another.
    response.headers.set("Cache-Control", "private, no-store");
  }

  /*
   * Gameplay APIs authorize the HttpOnly StackChips session themselves and
   * never inspect a Supabase access token. Calling auth.getUser() here added
   * an external Auth request to every fold, call, clock tick and snapshot for
   * no security benefit. Auth routes validate/refresh through their own
   * createServerSupabase client, and the OAuth callback performs its own code
   * exchange, so both paths are self-contained too.
   */
  if (
    request.nextUrl.pathname.startsWith("/api/")
    || request.nextUrl.pathname === "/auth/callback"
    || request.nextUrl.pathname === "/monitoring"
  ) {
    return response;
  }

  const url = readSupabaseUrl();
  const key = readSupabasePublicKey();
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Every dynamic request reaches the cheap origin/API fast path above.
     * Supabase refreshes only continue for rendered pages that actually read
     * a server-side session. Static/marketing pages (legal, store, leaderboard,
     * collection, about, help, how-to-play) never touch cookies() or a
     * Supabase server client, so routing them through auth.getUser() was a
     * pure round-trip tax on every load with nothing downstream to consume
     * the refreshed cookie. /rewards is left out of this list on purpose --
     * unlike those, it fetches /api/profile client-side to show a real Gold
     * balance and claim states, the same as /games and /challenges do.
     */
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icon.svg|icon-192.png|icon-512.png|apple-icon.png|sounds/|avatars/|legal/|store|leaderboard|collection|about|help|how-to-play).*)",
  ],
};
