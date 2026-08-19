import type { Metadata, Viewport } from "next";
import "./globals.css";

const TITLE = "StackChips - Play Free Texas Hold’em";
const DESCRIPTION =
  "Six-max Texas Hold’em, PvP duels, and cribbage tables played with Gold — an in-app currency with no cash value. No pure-chance games, no rake.";

export const metadata: Metadata = {
  metadataBase: new URL("https://stackchips.app"),
  title: TITLE,
  description: DESCRIPTION,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "StackChips",
  },
  // The opengraph-image.tsx file convention supplies the image itself; this
  // just fills in the text half of the card so a shared link reads right
  // before the image even loads (and for the platforms that skip images).
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://stackchips.app",
    siteName: "StackChips",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Kept in step with app/manifest.ts and the html/body base: this is the
  // colour the browser paints its own chrome with, so a stale value shows up
  // as a differently-coloured band above the page.
  themeColor: "#0f1218",
};

/*
 * The Adsterra loader used to sit in this body, as two <Script strategy=
 * "afterInteractive"> tags. It was removed rather than moved, and it is worth
 * knowing why before anyone puts it back.
 *
 * That unit's invoke script `document.write`s its markup at the position of
 * its own <script> tag. document.write is only defined during the initial
 * parse; called on a document that has already closed -- which is exactly what
 * "afterInteractive" means, since Next appends the tag after hydration -- it
 * implicitly calls document.open() and BLANKS THE PAGE. In an app whose entire
 * UI is one client tree, that is the table disappearing mid-hand.
 *
 * The unit now renders through components/ads/adsterra-slot.tsx, which gives
 * it its own sandboxed srcdoc document, so its document.write happens during a
 * parse (legal) in a document that is not ours (contained). The rewarded-ad
 * modal mounts it. Anything else wanting a banner should mount that component
 * too; nothing should reintroduce a loader here.
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
