import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StackChips - Texas Hold’em",
    short_name: "StackChips",
    description: "A server-authoritative six-max Texas Hold’em table.",
    start_url: "/",
    display: "standalone",
    // The violet-black "Neon Marquee" ground, the same #150a2b html/body sit
    // on (01-tokens.css). These two are what the OS paints around the app
    // (the splash while it boots and the strip behind the status bar), so a
    // stale value here shows up as an installed StackChips opening with a
    // differently-coloured frame around the room for as long as the launch
    // takes.
    background_color: "#150a2b",
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
