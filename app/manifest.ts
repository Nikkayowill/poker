import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // Shown on the install prompt and under the installed icon. Named for
    // the platform, not just the poker room -- this said "Texas Hold’em"
    // alone, which undersold everything beside the table (see the same fix
    // in app/layout.tsx's TITLE).
    name: "StackChips - Poker, Puzzles & Duels",
    short_name: "StackChips",
    description:
      "Free online games: six-max Texas Hold’em, 1v1 skill duels, cribbage and daily puzzles, one Gold wallet across all of them.",
    start_url: "/",
    display: "standalone",
    // What the OS paints around the app: background_color is the boot
    // splash, theme_color the band behind the iOS status bar (app/layout.tsx
    // uses the "default" status bar style) and Android's status bar. Keep
    // theme_color in step with app/layout.tsx's themeColor.
    background_color: "#241530",
    theme_color: "#150a2b",
    orientation: "portrait-primary",
    // Only list icons that actually exist. A manifest entry pointing at a 404
    // is not cosmetic: Chrome treats an unfetchable icon as a failed install
    // criterion, so a stale entry can suppress the install prompt entirely.
    // The install icon is deliberately NOT app/icon.svg's single "S" (Kayo
    // called it too generic for this spot, though it stays as the favicon
    // and the in-game/lobby nav mark). It's the stacked STACK/CHIPS lockup
    // at /icons/icon-stacked.svg, see that file for the full reasoning.
    // 192/512 rasters and app/apple-icon.png are generated from
    // it (public/brand/concepts/neon-marquee/wordmark-stacked.svg is the
    // documented source), so re-running that render is how these get
    // regenerated if the mark changes. The maskable variant pads the same
    // art to an 80% safe zone on a solid background; an "any"-purpose
    // maskable icon gets center-cropped by Android's adaptive-icon mask
    // otherwise.
    icons: [
      {
        src: "/icons/icon-stacked.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
