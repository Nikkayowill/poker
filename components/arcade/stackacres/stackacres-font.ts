import localFont from "next/font/local";

/**
 * StackAcres' display voice: Baloo 2, self-hosted.
 *
 * WHY A FONT AT ALL, in an app that deliberately loads none. Every brand mark
 * here is outlined SVG precisely so there is no font to load
 * (components/brand/stackacres-logo.tsx says so in its own header), and that
 * still holds -- the wordmark is untouched. This is a different job: the farm's
 * chrome is a physical toy box (see app/styles/52-stackacres.css), and a toy
 * box lettered in the same UI sans as a settings page is a sticker on a toy,
 * not a toy. The alternative was a system rounded stack, which renders as SF
 * Pro Rounded on Apple and as plain Roboto everywhere else -- a game that looks
 * like a different game per platform.
 *
 * Scoped to this one route. It is imported by
 * app/(lobby)/games/stackacres/page.tsx and applied to that page's wrapper, so
 * no other screen pays for it and nothing outside `.sa-theme` can reach it.
 *
 * One variable file, latin only, 33KB, weights 400-800 -- the whole ladder the
 * chrome uses comes out of a single request. Fetched from Google Fonts once and
 * vendored (see ./app/fonts/Baloo2-OFL.txt for the licence); nothing is fetched
 * at build or at runtime.
 *
 * The fallback stack matters more than usual here: `font-display: swap` means
 * real players read the fallback for the first paint, and a fallback with the
 * wrong metrics reflows every chunky button on the screen. Next measures the
 * declared fallback and synthesises matching metrics for the swap, so the
 * rounded system faces are listed ahead of the generic sans on purpose.
 */
export const stackAcresDisplay = localFont({
  src: "../../../app/fonts/baloo2-latin-variable.woff2",
  weight: "400 800",
  style: "normal",
  display: "swap",
  variable: "--font-sa-display",
  fallback: [
    "ui-rounded",
    "SF Pro Rounded",
    "Segoe UI Variable Display",
    "Nunito",
    "system-ui",
    "sans-serif",
  ],
});
