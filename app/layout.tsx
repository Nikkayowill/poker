import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Play Free, StackChips - Texas Hold’em",
  description: "A server-authoritative Texas Hold’em table powered by Supabase.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "StackChips",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Kept in step with app/manifest.ts and the html/body base: this is the
  // colour the browser paints its own chrome with, so a stale value shows up
  // as a differently-coloured band above the page.
  themeColor: "#0a0a0b",
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
