"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The one Supabase client the browser is allowed to have.
 *
 * supabase-js builds a GoTrueClient per call to createClient, and each one
 * registers its own storage listener and refresh timer against the same
 * session. Two of them race to refresh the same token and the library warns
 * about it. There were two: a cached one for sign-in, and a fresh one built
 * inside the Realtime effect on every mount -- doubled again by StrictMode in
 * development, which mounts, unmounts and mounts again.
 *
 * Module scope is the right lifetime here. It survives remounts and Fast
 * Refresh, so a component can ask for the client as often as it likes and
 * still get one auth instance and one websocket.
 */
let client: SupabaseClient | null = null;

export function browserSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}

/** Whether accounts are available at all in this deployment. */
export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
