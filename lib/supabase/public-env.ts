/**
 * Resolves the browser-safe Supabase credentials from either env var name.
 *
 * Supabase is replacing the legacy anon JWT with a publishable key
 * (`sb_publishable_...`) and plans to deprecate the legacy keys by the end of
 * 2026. Deployments will cross over one at a time, so both names have to work
 * -- and both have to work in the same build, since a rollback that swaps the
 * key back must not need a code change.
 *
 * Deliberately not `server-only`: middleware, Server Components, route
 * handlers, and the browser client all resolve the same pair, and having one
 * place to look is the point. Nothing here touches the service-role key,
 * which stays server-side in lib/server/runtime-config.ts.
 *
 * The `process.env.NEXT_PUBLIC_*` reads below must stay written out in full.
 * Next.js inlines those into the client bundle by literal text substitution,
 * so a computed lookup like `process.env[name]` would quietly resolve to
 * undefined in the browser.
 */

/** New name first: a deployment that has migrated should not keep using a stale legacy key it left behind. */
export function readSupabasePublicKey(): string {
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (publishable) return publishable;
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
}

export function readSupabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
}

/** Whether this deployment has browser-safe Supabase credentials at all. */
export function hasSupabasePublicConfig(): boolean {
  return Boolean(readSupabaseUrl() && readSupabasePublicKey());
}

/**
 * The env var name a deployment is actually using, for error messages that
 * would otherwise name a variable the operator never set.
 */
export function supabasePublicKeyVariableName(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
    ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    : "NEXT_PUBLIC_SUPABASE_ANON_KEY";
}
