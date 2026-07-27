import "server-only";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "river_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function readSessionToken(request: NextRequest): string | null {
  return request.cookies.get(COOKIE_NAME)?.value ?? null;
}

export function readOrCreateSessionToken(request: NextRequest): string {
  return readSessionToken(request) ?? randomUUID();
}

export function withSessionCookie<T extends NextResponse>(response: T, token: string): T {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return response;
}

/**
 * Drops the session cookie, which is what actually ends a sign-in: this
 * cookie is the credential every gameplay route trusts, so clearing the
 * provider's session alone would leave the next person at this browser
 * holding the previous player's profile.
 */
export function withoutSessionCookie<T extends NextResponse>(response: T): T {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
