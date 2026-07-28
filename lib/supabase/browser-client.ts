"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const REMEMBER_AUTH_KEY = "river-room:remember-auth";
const authStorageKeys = new Set<string>();

function browserStorage() {
  if (typeof window === "undefined") return null;
  return readRememberAuthSession() ? window.localStorage : window.sessionStorage;
}

/**
 * Supabase normally persists auth in localStorage. This adapter keeps that
 * behavior only when the player asks to stay signed in; otherwise the same
 * session is scoped to the current browser session.
 */
const authStorage = {
  getItem(key: string) {
    authStorageKeys.add(key);
    return browserStorage()?.getItem(key) ?? null;
  },
  setItem(key: string, value: string) {
    authStorageKeys.add(key);
    browserStorage()?.setItem(key, value);
  },
  removeItem(key: string) {
    authStorageKeys.add(key);
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  },
};

export function readRememberAuthSession(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(REMEMBER_AUTH_KEY) !== "false";
}

/**
 * Moves only the Supabase keys this client has actually used. That avoids
 * touching sessions belonging to another Supabase project on the same host.
 */
export function setRememberAuthSession(remember: boolean): void {
  if (typeof window === "undefined") return;
  const source = remember ? window.sessionStorage : window.localStorage;
  const destination = remember ? window.localStorage : window.sessionStorage;
  for (const key of authStorageKeys) {
    const value = source.getItem(key);
    if (value !== null) destination.setItem(key, value);
    source.removeItem(key);
  }
  window.localStorage.setItem(REMEMBER_AUTH_KEY, String(remember));
}

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
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: authStorage,
      },
    });
  }
  return client;
}

/** Whether accounts are available at all in this deployment. */
export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
