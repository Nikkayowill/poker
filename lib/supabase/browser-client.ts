"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasSupabasePublicConfig, readSupabasePublicKey, readSupabaseUrl } from "./public-env";

const REMEMBER_AUTH_KEY = "stackchips:remember-auth";

/** Only the UI's "Stay signed in" checkbox default; see the client docstring below. */
export function readRememberAuthSession(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(REMEMBER_AUTH_KEY) !== "false";
}

export function setRememberAuthSession(remember: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REMEMBER_AUTH_KEY, String(remember));
}

/**
 * The one Supabase client the browser is allowed to have.
 *
 * Session state lives in cookies (via @supabase/ssr), not localStorage. That
 * is what lets the OAuth callback route handler, a plain server request with
 * no client JS involved, exchange the code and have the resulting session
 * already be visible to this client and to every other server request on
 * the next render. It also avoids a bug class this app hit before: a
 * client-side PKCE verifier living in origin-scoped storage that a
 * redirect, a duplicate effect run, or a wrong storage backend could lose.
 *
 * "Stay signed in" is enforced by StackChips' own river_session cookie
 * (lib/server/session.ts), which is what actually gates gameplay identity.
 * This Supabase cookie is left on the library's default lifetime rather than
 * switched per-toggle; at most that means a browser Supabase still
 * recognizes after "don't remember me", which the account-entry screen
 * already treats as "here's your account, continue or sign out," not as an
 * automatic seat.
 *
 * Module scope is the right lifetime here: it survives remounts and Fast
 * Refresh, so a component can ask for the client as often as it likes and
 * still get one auth instance.
 */
let client: SupabaseClient | null = null;

export function browserSupabase(): SupabaseClient | null {
  const url = readSupabaseUrl();
  const key = readSupabasePublicKey();
  if (!url || !key) return null;
  if (!client) {
    client = createBrowserClient(url, key);
  }
  return client;
}

/** Whether accounts are available at all in this deployment. */
export function supabaseConfigured(): boolean {
  return hasSupabasePublicConfig();
}
