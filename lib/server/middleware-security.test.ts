import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn(async () => ({ data: {}, error: null })) }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser } })),
}));

import { middleware } from "../../middleware";

describe("middleware security and API fast path", () => {
  beforeEach(() => {
    getUser.mockClear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does no remote auth work and forbids caching for gameplay APIs", async () => {
    const response = await middleware(new NextRequest("https://www.stackchips.app/api/games/id"));

    expect(getUser).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects cross-site API mutations before remote auth work", async () => {
    const response = await middleware(new NextRequest("https://www.stackchips.app/api/games", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    }));

    expect(response.status).toBe(403);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("continues refreshing Supabase auth on rendered pages", async () => {
    await middleware(new NextRequest("https://www.stackchips.app/profile"));

    expect(getUser).toHaveBeenCalledOnce();
  });
});
