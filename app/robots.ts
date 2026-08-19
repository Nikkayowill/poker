import type { MetadataRoute } from "next";

/**
 * Kept minimal on purpose: everything under /api, /auth, and /admin is either
 * a mutation endpoint or gated by session already, and indexing it would only
 * ever surface a 401/404 in search results. /legal, /about, /help,
 * /how-to-play, and /rewards are the only pages meant to be found by a search
 * engine rather than reached by clicking through the app.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/auth/", "/admin"],
    },
    sitemap: "https://stackchips.app/sitemap.xml",
  };
}
