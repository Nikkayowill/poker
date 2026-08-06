import type { Metadata, Viewport } from "next";
import "./globals.css";
import Script from "next/script";

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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>

          {/* 1. Adsterra Configuration Options Script */}
        <Script id="adsterra-options" strategy="afterInteractive">
          {`
            window.atOptions = {
              'key' : '9**********a28b6f',
              'format' : 'iframe',
              'height' : 250,
              'width' : 300,
              'params' : {}
            };
          `}
        </Script>

        {/* 2. Adsterra Execution Invocation Script */}
        <Script 
          src="https://pl30614360.effectivecpmnetwork.com/c7/0f/54/c70f542f472123eecce05e14a79898f8.js"
          strategy="afterInteractive" 
        />
        {children}
      </body>
    </html>
  );
}
