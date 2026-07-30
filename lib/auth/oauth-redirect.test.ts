import { afterEach, describe, expect, it, vi } from "vitest";
import { oauthCallbackUrl, oauthSiteOrigin } from "./oauth-redirect";

describe("oauthCallbackUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the canonical production URL during server-side execution", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://vercel.app/");

    expect(oauthSiteOrigin(undefined)).toBe("https://poker-navy-six.vercel.app");
    expect(oauthCallbackUrl()).toBe(
      "https://poker-navy-six.vercel.app/auth/callback",
    );
  });

  it("pins deployed callbacks to the canonical production origin", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://wrong-host.example/");

    expect(oauthSiteOrigin("https://poker-preview.vercel.app")).toBe(
      "https://poker-navy-six.vercel.app",
    );
    expect(oauthCallbackUrl(oauthSiteOrigin("https://poker-preview.vercel.app"))).toBe(
      "https://poker-navy-six.vercel.app/auth/callback",
    );
  });

  it("uses localhost only when sign-in actually starts on localhost", () => {
    expect(oauthSiteOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(oauthCallbackUrl(oauthSiteOrigin("http://localhost:3000"))).toBe(
      "http://localhost:3000/auth/callback",
    );
  });

  it("does not let a stale production environment value force localhost", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");

    expect(oauthSiteOrigin("https://poker-navy-six.vercel.app")).toBe(
      "https://poker-navy-six.vercel.app",
    );
    expect(oauthSiteOrigin(undefined)).toBe("https://poker-navy-six.vercel.app");
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
