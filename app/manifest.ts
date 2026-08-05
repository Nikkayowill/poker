import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StackChips - Texas Hold’em",
    short_name: "StackChips",
    description: "A server-authoritative six-max Texas Hold’em table.",
    start_url: "/",
    display: "standalone",
    background_color: "#09110f",
    theme_color: "#09110f",
    orientation: "portrait-primary",
    // Only list icons that actually exist. A manifest entry pointing at a 404
    // is not cosmetic: Chrome treats an unfetchable icon as a failed install
    // criterion, so a stale entry can suppress the install prompt entirely.
    // 192/512 rasters are generated from app/icon.svg (see the git history
    // of public/icons/ for the ImageMagick invocation) rather than hand-drawn,
    // so re-running that conversion is how these get regenerated if the mark
    // changes. The maskable variant pads the same art to a ~80% safe zone on
    // a solid background -- an "any"-purpose maskable icon gets center-cropped
    // by Android's adaptive-icon mask otherwise.
    icons: [
      {
        src: "/icon.svg",
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
