import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { callerKey, enforceRateLimit, getClientIp } from "./rate-limit";

function request(token: string, ip: string) {
  return new NextRequest("https://stackchips.test/api/ai/chat", {
    headers: {
      cookie: `river_session=${token}`,
      "x-real-ip": ip,
    },
  });
}

describe("rate-limit caller identity", () => {
  it("does not treat fabricated session cookies as distinct callers", () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    expect(callerKey(request("fabricated-one", ip))).toBe(callerKey(request("fabricated-two", ip)));
    expect(callerKey(request("fabricated-one", ip))).toBe(`ip:${ip}`);
  });

  it("keeps a rotating-cookie caller inside the same IP bucket", () => {
    const route = `rate-limit-test:${randomUUID()}`;
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;

    expect(enforceRateLimit(request("cookie-one", ip), route, 1, 60_000)).toBeNull();
    expect(enforceRateLimit(request("cookie-two", ip), route, 1, 60_000)?.status).toBe(429);
  });

  it("prefers Vercel's overwritten forwarding header", () => {
    const edgeRequest = new NextRequest("https://stackchips.test/api/ai/chat", {
      headers: {
        "x-vercel-forwarded-for": "203.0.113.10",
        "x-forwarded-for": "198.51.100.42",
      },
    });

    expect(getClientIp(edgeRequest)).toBe("203.0.113.10");
  });

  it("marks rate-limit responses private and non-cacheable", () => {
    const route = `rate-limit-cache-test:${randomUUID()}`;
    const edgeRequest = request("cookie", "192.0.2.10");
    expect(enforceRateLimit(edgeRequest, route, 1, 60_000)).toBeNull();
    expect(enforceRateLimit(edgeRequest, route, 1, 60_000)?.headers.get("cache-control"))
      .toBe("private, no-store");
  });
});
