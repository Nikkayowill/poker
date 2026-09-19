import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { isCrossOriginMutation } from "./request-origin";

function request(
  method: string,
  origin?: string,
  fetchSite?: string,
  extraHeaders: Record<string, string> = {},
  url = "https://www.stackchips.app/api/games",
) {
  return new NextRequest(url, {
    method,
    headers: {
      ...(origin ? { origin } : {}),
      ...(fetchSite ? { "sec-fetch-site": fetchSite } : {}),
      ...extraHeaders,
    },
  });
}

describe("cross-origin mutation guard", () => {
  it("allows safe reads and same-origin writes", () => {
    expect(isCrossOriginMutation(request("GET", "https://attacker.example"))).toBe(false);
    expect(isCrossOriginMutation(request("POST", "https://www.stackchips.app"))).toBe(false);
  });

  it("rejects foreign, opaque, and malformed origins", () => {
    expect(isCrossOriginMutation(request("POST", "https://attacker.example"))).toBe(true);
    expect(isCrossOriginMutation(request("DELETE", "null"))).toBe(true);
    expect(isCrossOriginMutation(request("PATCH", "not an origin"))).toBe(true);
    expect(isCrossOriginMutation(request("POST", undefined, "cross-site"))).toBe(true);
  });

  it("allows originless server-to-server requests", () => {
    expect(isCrossOriginMutation(request("POST"))).toBe(false);
  });

  /**
   * The host the browser addressed decides this, not the framework's own view
   * of the URL. Next's dev server reports `http://localhost:<port>` as
   * nextUrl.origin whatever host the request arrived on, so comparing against
   * that rejected every same-origin write made over 127.0.0.1 -- which is the
   * address playwright.config.ts uses, so no E2E spec could sign in.
   */
  it("trusts the host the browser actually addressed", () => {
    // What `next dev --hostname 127.0.0.1` produces: nextUrl normalised to
    // localhost, Host carrying the address the browser really used.
    expect(isCrossOriginMutation(request(
      "POST",
      "http://127.0.0.1:3107",
      undefined,
      { host: "127.0.0.1:3107" },
      "http://localhost:3107/api/profile",
    ))).toBe(false);
  });

  it("still rejects a foreign origin on that same host", () => {
    expect(isCrossOriginMutation(request(
      "POST",
      "http://attacker.example",
      undefined,
      { host: "127.0.0.1:3107" },
      "http://localhost:3107/api/profile",
    ))).toBe(true);
  });

  it("reads the forwarded host and protocol a proxy set", () => {
    expect(isCrossOriginMutation(request("POST", "https://www.stackchips.app", undefined, {
      host: "poker-abc123.vercel.app",
      "x-forwarded-host": "www.stackchips.app",
      "x-forwarded-proto": "https",
    }))).toBe(false);
  });

  it("does not let a forwarded host launder a foreign origin", () => {
    expect(isCrossOriginMutation(request("POST", "https://attacker.example", undefined, {
      "x-forwarded-host": "www.stackchips.app",
      "x-forwarded-proto": "https",
    }))).toBe(true);
  });

  it("takes the proxy hop nearest this server, not the caller's own claim", () => {
    // A caller-supplied x-forwarded-host with the real one appended after it.
    // Reading the first entry would let that caller name its own origin.
    expect(isCrossOriginMutation(request("POST", "https://attacker.example", undefined, {
      "x-forwarded-host": "attacker.example, www.stackchips.app",
      "x-forwarded-proto": "https, https",
    }))).toBe(true);
  });

  it("keeps scheme part of the comparison", () => {
    expect(isCrossOriginMutation(request("POST", "http://www.stackchips.app", undefined, {
      host: "www.stackchips.app",
      "x-forwarded-proto": "https",
    }))).toBe(true);
  });
});
