import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
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
  const url = readSupabaseUrl();
  const key = readSupabasePublicKey();
  if (!url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });

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
     * Every request except static assets and Next's own internals -- a
     * session refresh has nothing to do with whether the request is an API
     * route, a page, or a Server Action, so this deliberately does not
     * scope down to app/api.
     */
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icon.svg|icon-192.png|icon-512.png|apple-icon.png|sounds/|avatars/).*)",
  ],
};
