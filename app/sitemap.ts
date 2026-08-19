import type { MetadataRoute } from "next";

/**
 * Only the pages that exist independent of a signed-in session -- the same
 * set middleware.ts already exempts from the auth-refresh path (see its
 * matcher comment). The lobby/table/arcade routes are all behind sign-in or
 * guest-session state and have nothing stable to index.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://stackchips.app";
  const now = new Date();
  const staticPages = ["/about", "/help", "/how-to-play", "/rewards", "/store"];
  const legalPages = ["/legal", "/legal/terms", "/legal/privacy", "/legal/gold-disclosure", "/legal/support", "/legal/disclaimer"];

  return [
    { url: base, lastModified: now, changeFrequency: "weekly", priority: 1 },
    ...staticPages.map((path) => ({
      url: `${base}${path}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    ...legalPages.map((path) => ({
      url: `${base}${path}`,
      lastModified: now,
      changeFrequency: "yearly" as const,
      priority: 0.3,
    })),
  ];
}
