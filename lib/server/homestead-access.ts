import "server-only";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * Who may reach the Homestead while it is on the floor but not open.
 *
 * This replaces an allowlist of Supabase account ids. That version worked and
 * was never the problem, but it made the game reachable only by whoever was
 * named in a variable, which meant "let a friend look at it" was a deploy. A
 * code is the thing that was actually wanted: the tile is visible to everyone,
 * and the door opens for anyone who was told the word.
 *
 * ONE SHARED CODE, in HOMESTEAD_ACCESS_CODE. Not per-player, because there is
 * no invite record to hang a per-player code on and inventing one would be a
 * table and a lifecycle for a game nobody has played yet.
 *
 * IN ENV, NEVER IN THE REPO -- this repository is public, so a committed code
 * is no code at all. There is deliberately no default: an unset or empty
 * variable admits NOBODY rather than opening the door, the same posture
 * ADMIN_SECRET takes. The cost is that forgetting the variable looks exactly
 * like the feature being broken, so say so plainly wherever this is deployed.
 *
 * WHAT THE COOKIE HOLDS is a signature of the code, never the code. So:
 *   * a stolen cookie is worth exactly as much as the code it came from, which
 *     is a thing people are meant to pass around anyway;
 *   * rotating HOMESTEAD_ACCESS_CODE invalidates every pass already issued,
 *     with no revocation list, because the expected value is recomputed from
 *     the live code on every request;
 *   * a forged cookie needs the code (or SESSION_SECRET), so guessing the
 *     cookie is no easier than guessing the code.
 *
 * The rate limit on the unlock route is what makes the code itself hard to
 * guess -- see app/api/homestead/unlock/route.ts. A short code with no limiter
 * in front of it is a password anyone can brute force in an afternoon, and
 * these routes move real Gold.
 */

const LEGACY_PASS_COOKIE = "river_homestead";
const HOST_PASS_COOKIE = "__Host-river_homestead";
const PASS_MAX_AGE = 60 * 60 * 24 * 365;

export function homesteadPassCookieName(): string {
  return process.env.NODE_ENV === "production" ? HOST_PASS_COOKIE : LEGACY_PASS_COOKIE;
}

function safeTextEqual(first: string, second: string): boolean {
  // Hash to a fixed length first: timingSafeEqual throws on a length mismatch,
  // and that throw would itself be an oracle for the code's length. Same
  // helper session.ts and admin-auth.ts each keep their own copy of, for the
  // reason CLAUDE.md gives about not coupling modules over a security
  // primitive to save four lines.
  const firstHash = createHash("sha256").update(first).digest();
  const secondHash = createHash("sha256").update(second).digest();
  return timingSafeEqual(firstHash, secondHash);
}

/** The configured code, or null when the Homestead is closed to everyone. */
export function homesteadAccessCode(): string | null {
  const code = (process.env.HOMESTEAD_ACCESS_CODE ?? "").trim();
  return code.length > 0 ? code : null;
}

/**
 * The cookie value a correct code earns. Derived from the code itself, keyed
 * on SESSION_SECRET when there is one -- and on the code when there is not,
 * which is still unguessable to anyone who does not have the code. That keeps
 * this from becoming a second way the app goes dark on a missing secret, the
 * rule session.ts states for its own signing.
 */
function homesteadPass(code: string): string {
  const secret = process.env.SESSION_SECRET || code;
  return createHmac("sha256", secret).update(`stackchips-homestead:${code}`).digest("base64url");
}

/** Whether this cookie jar carries a pass matching the code configured now. */
export function isHomesteadUnlocked(get: (name: string) => string | undefined): boolean {
  const code = homesteadAccessCode();
  if (!code) return false;
  const value = get(HOST_PASS_COOKIE) ?? get(LEGACY_PASS_COOKIE) ?? null;
  return value !== null && safeTextEqual(value, homesteadPass(code));
}

/** The same check for a route holding a NextRequest. */
export function requestHasHomesteadPass(request: NextRequest): boolean {
  return isHomesteadUnlocked((name) => request.cookies.get(name)?.value);
}

/** Whether a submitted code is the configured one. */
export function isHomesteadCode(submitted: string): boolean {
  const code = homesteadAccessCode();
  return code !== null && safeTextEqual(submitted, code);
}

/**
 * Issues the pass. `__Host-` in production, which forces secure + path=/ and
 * no domain -- path=/ is the part that matters here, and it is exactly what
 * the old admin gate could not have: ADMIN_SESSION_COOKIE was scoped to
 * /api/admin, so a page could never see the cookie that authorised it.
 */
export function withHomesteadPassCookie<T extends NextResponse>(response: T): T {
  const code = homesteadAccessCode();
  if (!code) return response;
  response.cookies.set(homesteadPassCookieName(), homesteadPass(code), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PASS_MAX_AGE,
  });
  return response;
}

/**
 * What a caller without the pass gets from the API.
 *
 * 401, not the 404 the allowlist version answered. That 404 existed to hide
 * the feature's existence, and the tile on the arcade floor now announces it,
 * so pretending the route is not there only makes a locked door confusing.
 * The body names the reason so the client can send the player to the code
 * prompt rather than showing "something went wrong".
 */
export function homesteadLocked(): NextResponse {
  return NextResponse.json({ error: "This needs an access code.", locked: true }, { status: 401 });
}
