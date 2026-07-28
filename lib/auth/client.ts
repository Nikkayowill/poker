"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { browserSupabase, supabaseConfigured } from "@/lib/supabase/browser-client";

/**
 * The browser-side Supabase client, used only for signing in. Gameplay still
 * runs on the HttpOnly session cookie, so this client's job ends the moment
 * it has produced an access token for /api/auth/link to verify.
 *
 * Returns null in local demo mode, where there is no Supabase project to
 * authenticate against and accounts are simply unavailable.
 *
 * This is the shared instance -- see lib/supabase/browser-client.ts for why
 * there must only ever be one.
 */
export function authClient(): SupabaseClient | null {
  return browserSupabase();
}

/** Whether accounts are available at all in this deployment. */
export function accountsEnabled(): boolean {
  return supabaseConfigured();
}
