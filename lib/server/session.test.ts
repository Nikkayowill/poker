import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it } from "vitest";
import {
  readSessionPersistence,
  withRequestSessionCookie,
  withSessionPreferenceCookie,
  withoutSessionCookie,
} from "./session";

describe("session persistence preference", () => {
  it("defaults to a persistent River Room identity", () => {
    const request = new NextRequest("https://river-room.test/");
    const response = withRequestSessionCookie(request, NextResponse.json({ ok: true }), "player-token");

    expect(readSessionPersistence(request)).toBe(true);
    expect(response.cookies.get("river_session")?.maxAge).toBeGreaterThan(0);
  });

  it("keeps subsequent gameplay cookies session-only when remember is off", () => {
    const request = new NextRequest("https://river-room.test/", {
      headers: { cookie: "river_remember=false" },
    });
    const response = withRequestSessionCookie(request, NextResponse.json({ ok: true }), "player-token");

    expect(readSessionPersistence(request)).toBe(false);
    expect(response.cookies.get("river_session")?.maxAge).toBeUndefined();
  });

  it("clears both the identity and its persistence preference on sign-out", () => {
    const preferred = withSessionPreferenceCookie(NextResponse.json({ ok: true }), true);
    expect(preferred.cookies.get("river_remember")?.value).toBe("true");

    const signedOut = withoutSessionCookie(NextResponse.json({ ok: true }));
    expect(signedOut.cookies.get("river_session")?.maxAge).toBe(0);
    expect(signedOut.cookies.get("river_remember")?.maxAge).toBe(0);
  });
});
