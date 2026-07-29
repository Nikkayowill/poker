export const OAUTH_CALLBACK_PATH = "/auth/callback";

function normalizedHttpOrigin(origin: string): string {
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") {
    throw new Error("OAuth callbacks require an HTTP(S) origin.");
  }

  return parsedOrigin.origin;
}

export function oauthSiteOrigin(): string {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_SITE_URL;

  if (!origin) {
    throw new Error("NEXT_PUBLIC_SITE_URL is required outside the browser.");
  }

  return normalizedHttpOrigin(origin);
}

/**
 * Keep the PKCE callback on the origin that initiated sign-in. The verifier
 * lives in origin-scoped browser storage, so changing hosts mid-flow would
 * make an otherwise valid Google callback impossible to exchange.
 */
export function oauthCallbackUrl(origin: string = oauthSiteOrigin()): string {
  return new URL(OAUTH_CALLBACK_PATH, normalizedHttpOrigin(origin)).toString();
}
