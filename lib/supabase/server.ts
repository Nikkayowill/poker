import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The server-side counterpart to lib/supabase/browser-client.ts's cookie
 * session. Both read and write the same Supabase auth cookies, which is the
 * entire point of the @supabase/ssr package: a session established by the
 * OAuth callback route handler is immediately visible to any other server
 * request, with no client-side storage or timing involved.
 *
 * Route Handlers can mutate cookies directly. Server Components cannot --
 * `cookieStore.set` throws there, which this swallows, matching Supabase's
 * documented pattern. A Component-triggered token refresh is instead
 * persisted by middleware.ts, which runs before the Component does.
 */
export async function createServerSupabase(): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component -- middleware.ts refreshes instead.
        }
      },
    },
  });
}
