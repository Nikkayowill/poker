import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { isCrossOriginMutation } from "./request-origin";

function request(method: string, origin?: string, fetchSite?: string) {
  return new NextRequest("https://www.stackchips.app/api/games", {
    method,
    headers: {
      ...(origin ? { origin } : {}),
      ...(fetchSite ? { "sec-fetch-site": fetchSite } : {}),
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
});
