import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureProfile, findProfileBySessionToken } from "@/lib/server/profile-store";
import { POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

function request(token: string, ip: string) {
  return new NextRequest("https://stackchips.test/api/ai/chat", {
    method: "POST",
    headers: {
      cookie: `river_session=${token}`,
      "content-type": "application/json",
      "x-real-ip": ip,
    },
    body: JSON.stringify({ message: "What is a flush?" }),
  });
}

describe("POST /api/ai/chat", () => {
  it("rejects a fabricated session cookie without creating a profile", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const token = randomUUID();

    const response = await POST(request(token, `203.0.113.${Math.floor(Math.random() * 200) + 1}`));

    expect(response.status).toBe(401);
    expect(await findProfileBySessionToken(token)).toBeNull();
  });

  it("preserves access for a session backed by a server-side profile", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const token = randomUUID();
    await ensureProfile(token);

    const response = await POST(request(token, `198.51.100.${Math.floor(Math.random() * 200) + 1}`));

    // The request passed session validation and reached the existing config
    // guard; it must not be rejected merely because the cookie is bearer-style.
    expect(response.status).toBe(503);
  });
});
