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
      "Free online games: six-max Texas Hold’em, 1v1 skill duels, blackjack, cribbage and daily puzzles, one Gold wallet across all of them.",
    start_url: "/",
    display: "standalone",
    // These two are what the OS paints AROUND the app rather than inside it:
    // background_color is the window the web view sits in (and the boot
    // splash), theme_color the strip behind the status bar. Nothing in the
    // document can paint over either of them.
    //
    // background_color is deliberately NOT --brand-ink (#150a2b, the ground
    // html/body sit on in 01-tokens.css) even though every other "what colour
    // is the app" answer is. It is --brand-room-floor, the colour the room
    // resolves to along its own BOTTOM edge, because the bottom edge is the
    // only place this value is ever seen. Keep the two in step: if
    // --brand-room-floor is ever re-measured, re-measure this with it.
    //
    // Why that matters, since eleven commits have now been spent on it. On
    // this installed iOS PWA's cold launch the web view's FRAME is about 47px
    // shorter than the viewport it reports, so the bottom 47px of a correctly
    // laid-out page is simply not on screen and the OS fills the gap with
    // this colour -- a flat violet band under the tab pill, which is what was
    // reported. Measured off a screen recording (2026-09-07, iPhone at
    // 390x844): the band is dead flat, full width, identical on the lobby and
    // the sign-in page despite their different room gradients, cuts in at
    // exactly y=797 on both, and reads #150a2b -- this value, not the
    // #241530 the document paints its own canvas (02-app-shell.css). The tab
    // pill is CLIPPED mid-body at that line rather than sitting above it,
    // which is the tell: the document laid the pill out against a full 844px
    // viewport and the frame cut it off.
    //
    // That also rules the document out as the fix. --vp-short
    // (components/shell/viewport-fit.tsx) measures screen.height minus
    // innerHeight and reads 0 here, correctly -- innerHeight is already the
    // full 844. There is no API for "my frame is smaller than my viewport",
    // so no CSS or JS in this app can reach the band. Matching its colour to
    // the room's floor is the whole of what can be done, and it makes the
    // band invisible rather than absent: the 47px stays lost until a rotation
    // makes WebKit re-frame the view. See the block at the top of
    // 45-mobile-shell.css.
    //
    // theme_color stays --brand-ink. It is the top of the room, not the
    // bottom, and iOS ignores it entirely under the black-translucent status
    // bar this app asks for (app/layout.tsx) -- it is Android's status bar
    // that reads it, over a room that is still #150a2b up there.
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
