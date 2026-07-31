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
    orientation: "any",
    // Only list icons that actually exist. A manifest entry pointing at a 404
    // is not cosmetic: Chrome treats an unfetchable icon as a failed install
    // criterion, so a stale entry can suppress the install prompt entirely.
    // The raster sizes are intentionally absent pending a replacement set --
    // re-add 192/512 PNG entries here when those land.
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
