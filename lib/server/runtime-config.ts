import "server-only";

export interface SupabaseRuntimeConfig {
  url: string;
  publicKey: string;
  serviceKey: string;
}

const requiredVariables = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

/**
 * Returns a complete Supabase configuration, or null for the intentional
 * in-memory development mode. Production fails closed so a misconfigured
 * deployment cannot silently host disposable games in one server instance.
 */
export function readSupabaseRuntimeConfig(): SupabaseRuntimeConfig | null {
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "",
  };
  const missing = requiredVariables.filter((name) => !values[name]);

  if (missing.length === requiredVariables.length && process.env.NODE_ENV !== "production") {
    return null;
  }
  if (missing.length > 0) {
    throw new Error(`Incomplete Supabase configuration: missing ${missing.join(", ")}.`);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(values.NEXT_PUBLIC_SUPABASE_URL);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid URL.");
  }
  if (process.env.NODE_ENV === "production" && parsedUrl.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTPS in production.");
  }

  return {
    url: values.NEXT_PUBLIC_SUPABASE_URL,
    publicKey: values.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceKey: values.SUPABASE_SERVICE_ROLE_KEY,
  };
}
