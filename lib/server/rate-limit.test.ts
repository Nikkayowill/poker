import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("keeps a rotating-cookie caller inside the same IP bucket", async () => {
    const route = `rate-limit-test:${randomUUID()}`;
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;

    expect(await enforceRateLimit(request("cookie-one", ip), route, 1, 60_000)).toBeNull();
    expect((await enforceRateLimit(request("cookie-two", ip), route, 1, 60_000))?.status).toBe(429);
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

  it("marks rate-limit responses private and non-cacheable", async () => {
    const route = `rate-limit-cache-test:${randomUUID()}`;
    const edgeRequest = request("cookie", "192.0.2.10");
    expect(await enforceRateLimit(edgeRequest, route, 1, 60_000)).toBeNull();
    expect((await enforceRateLimit(edgeRequest, route, 1, 60_000))?.headers.get("cache-control"))
      .toBe("private, no-store");
  });
});

// UPSTASH_REDIS_REST_URL/TOKEN are read once at module load, so exercising
// the Redis-backed branch means mocking @upstash/redis and @upstash/ratelimit
// before importing rate-limit.ts, in an isolated module registry per test.
describe("rate-limit with Upstash configured", () => {
  const priorUrl = process.env.UPSTASH_REDIS_REST_URL;
  const priorToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  afterEach(() => {
    vi.doUnmock("@upstash/redis");
    vi.doUnmock("@upstash/ratelimit");
    vi.resetModules();
    if (priorUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = priorUrl;
    if (priorToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = priorToken;
  });

  it("calls the Upstash sliding-window limiter instead of the in-memory map", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

    const limitSpy = vi.fn().mockResolvedValue({ success: true, reset: Date.now() + 1000 });
    vi.doMock("@upstash/redis", () => ({ Redis: vi.fn() }));
    vi.doMock("@upstash/ratelimit", () => {
      // A vi.fn() constructed with `new` requires a real constructor as its
      // implementation -- an arrow function has no [[Construct]] and throws
      // "is not a constructor", so this uses a function expression instead.
      function Ratelimit() {
        return { limit: limitSpy };
      }
      Ratelimit.slidingWindow = vi.fn().mockReturnValue("sliding-window-config");
      return { Ratelimit };
    });

    vi.resetModules();
    const { enforceRateLimit: enforceWithRedis } = await import("./rate-limit");
    const result = await enforceWithRedis(request("cookie", "192.0.2.20"), `redis-test:${randomUUID()}`, 5, 30_000);

    expect(result).toBeNull();
    expect(limitSpy).toHaveBeenCalledTimes(1);
  });

  it("returns a 429 when the Upstash limiter reports failure", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

    const resetAt = Date.now() + 5_000;
    vi.doMock("@upstash/redis", () => ({ Redis: vi.fn() }));
    vi.doMock("@upstash/ratelimit", () => {
      function Ratelimit() {
        return { limit: vi.fn().mockResolvedValue({ success: false, reset: resetAt }) };
      }
      Ratelimit.slidingWindow = vi.fn().mockReturnValue("sliding-window-config");
      return { Ratelimit };
    });

    vi.resetModules();
    const { enforceRateLimit: enforceWithRedis } = await import("./rate-limit");
    const result = await enforceWithRedis(request("cookie", "192.0.2.21"), `redis-test:${randomUUID()}`, 5, 30_000);

    expect(result?.status).toBe(429);
  });
});
