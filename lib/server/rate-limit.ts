import "server-only";
import { NextRequest, NextResponse } from "next/server";

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
 * Fixed-window limiter keyed by caller. Good enough to blunt scripted abuse
 * against a single server instance; it is not a substitute for an edge-level
 * limiter in a multi-instance deployment.
 */
export function checkRateLimit(
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

/** Best-effort source IP from proxy headers -- "unknown" when neither is present (e.g. local dev). */
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/** Identifies a caller for rate-limiting: the session token when present, else the source IP. */
export function callerKey(request: NextRequest): string {
  const token = request.cookies.get("river_session")?.value;
  if (token) return `token:${token}`;
  return `ip:${getClientIp(request)}`;
}

export function rateLimited(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many requests. Please slow down and try again shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

/** Convenience guard: returns a 429 response to return early, or null to proceed. */
export function enforceRateLimit(
  request: NextRequest,
  route: string,
  limit: number,
  windowMs: number,
): NextResponse | null {
  const result = checkRateLimit(`${route}:${callerKey(request)}`, limit, windowMs);
  return result.ok ? null : rateLimited(result.retryAfterSeconds);
}
