import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readSupabaseRuntimeConfig } from "./runtime-config";

let client: SupabaseClient | null | undefined;

/**
 * The service-role Supabase client, in its own module so it has no
 * dependency on any particular store. game-store.ts and stats-store.ts both
 * need it, and stats-store.ts also needs to be reachable *from*
 * game-store.ts (a hand completing while catching up a stale table is
 * exactly where a stat has to be recorded) -- if this lived inside
 * game-store.ts, that would be a straight import cycle.
 */
export function adminClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const config = readSupabaseRuntimeConfig();
  if (!config) {
    client = null;
    return client;
  }
  client = createClient(config.url, config.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}
