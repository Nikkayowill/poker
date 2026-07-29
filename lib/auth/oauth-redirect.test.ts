import { describe, expect, it } from "vitest";
import { oauthCallbackUrl } from "./oauth-redirect";

describe("oauthCallbackUrl", () => {
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
});
