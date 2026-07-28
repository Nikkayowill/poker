import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "River Room - Texas Hold’em",
    short_name: "River Room",
    description: "A server-authoritative six-max Texas Hold’em table.",
    start_url: "/",
    display: "standalone",
    background_color: "#09110f",
    theme_color: "#09110f",
    orientation: "any",
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
