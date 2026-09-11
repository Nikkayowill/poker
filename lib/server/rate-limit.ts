import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

interface Bucket {
  count: number;
  resetAt: number;
}

declare global {
  var __riverRoomRateLimits: Map<string, Bucket> | undefined;
}

const buckets = globalThis.__riverRoomRateLimits ?? new Map<string, Bucket>();
globalThis.__riverRoomRateLimits = buckets;

// Bound memory use for a long-running dev/demo process: on a fraction of
// calls, drop any bucket whose window has already elapsed.
function sweep(now: number) {
  if (Math.random() > 0.02) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * In-process fixed-window limiter. Same-instance only -- fine for local dev
 * and tests, but on a multi-instance deployment each instance gets its own
 * buckets, so this alone does not actually cap a distributed caller.
 */
function checkRateLimitInMemory(
  key: string,
  limit: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = Date.now();
  sweep(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { ok: true };
}

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = UPSTASH_URL && UPSTASH_TOKEN
  ? new Redis({ url: UPSTASH_URL, token: UPSTASH_TOKEN })
  : null;

// One Ratelimit instance per distinct (limit, windowMs) pair, so every route
// with the same shape shares a limiter instead of allocating one per call.
const redisLimiters = new Map<string, Ratelimit>();
function redisLimiterFor(limit: number, windowMs: number): Ratelimit {
  const cacheKey = `${limit}:${windowMs}`;
  let limiter = redisLimiters.get(cacheKey);
  if (!limiter) {
    limiter = new Ratelimit({
      redis: redis!,
      limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
      // Buckets are already namespaced per route+caller by the key we pass
      // in; this is just the key's Redis-side prefix.
      prefix: "ratelimit",
    });
    redisLimiters.set(cacheKey, limiter);
  }
  return limiter;
}

async function checkRateLimitRedis(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const { success, reset } = await redisLimiterFor(limit, windowMs).limit(key);
  if (success) return { ok: true };
  return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((reset - Date.now()) / 1000)) };
}

/**
 * Fixed-window limiter keyed by source IP. Cookies are bearer identifiers
 * supplied by the caller, so they must never be the only input to a limiter:
 * an attacker could otherwise mint a fresh cookie value for every request.
 *
 * Shared across instances when UPSTASH_REDIS_REST_URL/TOKEN are set (see
 * .env.example); falls back to the process-local Map otherwise, which is
 * genuinely sufficient for local dev and tests but not for a multi-instance
 * production deployment.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  if (redis) return checkRateLimitRedis(key, limit, windowMs);
  return checkRateLimitInMemory(key, limit, windowMs);
}

/** Best-effort source IP from proxy headers -- "unknown" when neither is present (e.g. local dev). */
export function getClientIp(request: NextRequest): string {
  // Vercel overwrites both forwarding headers at its edge. Prefer its
  // platform-specific header so a proxy placed in front of Vercel cannot
  // accidentally turn an upstream caller-supplied value into the key.
  const forwarded = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/**
 * Identifies a caller for rate-limiting without trusting a client-controlled
 * session cookie. Authenticated routes can still validate that cookie for
 * access, but the limiter remains effective when the cookie is fabricated.
 */
export function callerKey(request: NextRequest): string {
  return `ip:${getClientIp(request)}`;
}

export function rateLimited(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many requests. Please slow down and try again shortly." },
    {
      status: 429,
      headers: {
        "Cache-Control": "private, no-store",
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}

/** Convenience guard: returns a 429 response to return early, or null to proceed. */
export async function enforceRateLimit(
  request: NextRequest,
  route: string,
  limit: number,
  windowMs: number,
): Promise<NextResponse | null> {
  const result = await checkRateLimit(`${route}:${callerKey(request)}`, limit, windowMs);
  return result.ok ? null : rateLimited(result.retryAfterSeconds);
}
