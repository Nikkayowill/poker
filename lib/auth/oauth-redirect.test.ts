import { afterEach, describe, expect, it, vi } from "vitest";
import { oauthCallbackUrl, oauthSiteOrigin } from "./oauth-redirect";

describe("oauthCallbackUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the configured site URL during server-side execution", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://poker-navy-six.vercel.app/");

    expect(oauthSiteOrigin()).toBe("https://poker-navy-six.vercel.app");
    expect(oauthCallbackUrl()).toBe(
      "https://poker-navy-six.vercel.app/auth/callback",
    );
  });

  it("keeps production callbacks on the origin that started PKCE", () => {
    expect(oauthCallbackUrl("https://poker-navy-six.vercel.app")).toBe(
      "https://poker-navy-six.vercel.app/auth/callback",
    );
  });

  it("uses localhost only when sign-in actually starts on localhost", () => {
    expect(oauthCallbackUrl("http://localhost:3000")).toBe(
      "http://localhost:3000/auth/callback",
    );
  });

  it("never carries a poker route or query into the OAuth callback", () => {
    expect(oauthCallbackUrl("https://poker-navy-six.vercel.app/table?code=RIVER")).toBe(
      "https://poker-navy-six.vercel.app/auth/callback",
    );
  });

  it("rejects non-HTTP callback origins", () => {
    expect(() => oauthCallbackUrl("javascript:alert(1)")).toThrow(
      "OAuth callbacks require an HTTP(S) origin.",
    );
  });
});
