import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hasSupabasePublicConfig,
  readSupabasePublicKey,
  readSupabaseUrl,
  supabasePublicKeyVariableName,
} from "./public-env";

/**
 * Supabase is retiring the anon JWT in favour of a publishable key, and
 * deployments cross over one at a time. Both names have to resolve from the
 * same build, in both directions, so a migration can be rolled back without
 * shipping code.
 */
describe("readSupabasePublicKey", () => {
  const original = {
    publishable: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  afterEach(() => {
    for (const [name, value] of [
      ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", original.publishable],
      ["NEXT_PUBLIC_SUPABASE_ANON_KEY", original.anon],
      ["NEXT_PUBLIC_SUPABASE_URL", original.url],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("accepts the legacy anon key on its own", () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "legacy-anon-jwt";
    expect(readSupabasePublicKey()).toBe("legacy-anon-jwt");
    expect(supabasePublicKeyVariableName()).toBe("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("accepts the publishable key on its own", () => {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_abc";
    expect(readSupabasePublicKey()).toBe("sb_publishable_abc");
    expect(supabasePublicKeyVariableName()).toBe("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  });

  it("prefers the publishable key when a deployment still has both set", () => {
    // The realistic mid-migration state: the new key is added before the old
    // one is deleted. Preferring the new one means adding it is what
    // completes the migration, with the stale legacy key left as the rollback.
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_abc";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "legacy-anon-jwt";
    expect(readSupabasePublicKey()).toBe("sb_publishable_abc");
  });

  it("treats a blank or whitespace-only value as unset", () => {
    // Vercel and Playwright both express "off" as an empty string rather
    // than an absent variable, and an empty key must fall through to the
    // other name instead of configuring a broken client.
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "   ";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "legacy-anon-jwt";
    expect(readSupabasePublicKey()).toBe("legacy-anon-jwt");

    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    expect(readSupabasePublicKey()).toBe("");
  });

  it("reports no public config when neither name is set", () => {
    expect(readSupabasePublicKey()).toBe("");
    expect(readSupabaseUrl()).toBe("");
    expect(hasSupabasePublicConfig()).toBe(false);
  });

  it("needs both a URL and a key before it claims to be configured", () => {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_abc";
    expect(hasSupabasePublicConfig()).toBe(false);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    expect(hasSupabasePublicConfig()).toBe(true);
  });
});
