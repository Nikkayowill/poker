"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * The browser-side Supabase client, used only for signing in. Gameplay still
 * runs on the HttpOnly session cookie, so this client's job ends the moment
 * it has produced an access token for /api/auth/link to verify.
 *
 * Returns null in local demo mode, where there is no Supabase project to
 * authenticate against and accounts are simply unavailable.
 */
export function authClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!cached) {
    cached = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return cached;
}

/** Whether accounts are available at all in this deployment. */
export function accountsEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
