import "server-only";
import { readSupabasePublicKey, readSupabaseUrl } from "@/lib/supabase/public-env";

export interface SupabaseRuntimeConfig {
  url: string;
  publicKey: string;
  serviceKey: string;
}

/**
 * Returns a complete Supabase configuration, or null for the intentional
 * in-memory development mode. Production fails closed so a misconfigured
 * deployment cannot silently host disposable games in one server instance.
 *
 * The browser-safe key may arrive under either env var name -- see
 * lib/supabase/public-env.ts -- so the missing-variable report below names
 * both, rather than a single name an operator may have deliberately
 * migrated away from.
 */
export function readSupabaseRuntimeConfig(): SupabaseRuntimeConfig | null {
  const resolved = {
    url: readSupabaseUrl(),
    publicKey: readSupabasePublicKey(),
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "",
  };

  const missing = [
    resolved.url ? null : "NEXT_PUBLIC_SUPABASE_URL",
    resolved.publicKey
      ? null
      : "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    resolved.serviceKey ? null : "SUPABASE_SERVICE_ROLE_KEY",
  ].filter((name): name is string => name !== null);

  // Nothing configured at all is the deliberate memory mode, not a mistake.
  // A partial configuration always is one.
  if (missing.length === 3 && process.env.NODE_ENV !== "production") {
    return null;
  }
  if (missing.length > 0) {
    throw new Error(`Incomplete Supabase configuration: missing ${missing.join(", ")}.`);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(resolved.url);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid URL.");
  }
  if (process.env.NODE_ENV === "production" && parsedUrl.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTPS in production.");
  }

  return resolved;
}
