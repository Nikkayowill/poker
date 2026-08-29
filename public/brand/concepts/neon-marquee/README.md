# Neon Marquee — logo assets

Direction C ("Neon Wordmark") from the Neon Marquee brand concept, built into
real files. `app/icon.svg` (favicon, in-game header, lobby nav), the
sign-in/lobby wordmark, and the PWA install icon in `app/manifest.ts` are all
wired to marks built here now — see "What's here" for which file backs
which surface. Still a delivery folder in spirit, not the live asset path
itself: the app's own copies (`app/icon.svg`, `app/apple-icon.png`,
`public/icons/*`) are what actually ship, built from the sources below.

## What's here

- **`wordmark.svg`** — the primary lockup, level. STACK in chalk (`#f6f1ff`),
  CHIPS in marquee yellow (`#ffd23f`). Use for nav bars, footers, merch,
  anywhere a horizontal logo is needed at any size.
- **`wordmark-hero.svg`** — same lockup, tilted -2° with a two-colour glow
  filter. For large placements only (loading screen, sign-in, marketing) —
  the glow costs more to render than it's worth at UI scale.
- **`monogram.svg`** — the S, alone, on a rounded purple-black badge with a
  yellow baseline rule. Favicon/app-icon source. Same reasoning
  `app/icon.svg` already documents for the live mark: a wordmark collapses
  into a smudge at 16–32px, so the small mark is one unmistakable shape
  instead of a shrunk logo.
- **`monogram-maskable.svg`** — the same S, padded into Android's ~80%
  adaptive-icon safe zone on a square (non-rounded) background, since the OS
  applies its own mask shape.
- **`icon-16.png` / `icon-32.png` / `icon-192.png` / `icon-512.png`** —
  `monogram.svg` rasterized at each size a manifest/favicon actually needs.
- **`icon-512-maskable.png`** — `monogram-maskable.svg` rasterized.
- **`wordmark-stacked.svg`** — STACK and CHIPS re-laid-out as two centered
  rows instead of one wide line, same glyph outlines and colors as
  `wordmark.svg`, on the same rounded purple-black badge as `monogram.svg`.
  This is the PWA install icon: Kayo found the plain "S" too generic for
  that spot specifically (it stays for the favicon and in-game/lobby nav),
  so `app/manifest.ts`'s manifest icons and `app/apple-icon.png` point here
  instead. `public/icons/icon-stacked.svg` is a plain copy at a path the
  manifest can reference directly; keep the two in step.
- **`wordmark-stacked-maskable.svg`** — the same stacked lockup, padded into
  the 80% safe zone on a flat background, same relationship
  `monogram-maskable.svg` has to `monogram.svg`.
- **`icon-stacked-192.png` / `icon-stacked-512.png`** —
  `wordmark-stacked.svg` rasterized at each size a manifest/apple-touch-icon
  actually needs.
- **`icon-stacked-512-maskable.png`** — `wordmark-stacked-maskable.svg`
  rasterized.
- **`preview-on-dark-wordmark.png`** / **`preview-on-dark-wordmark-hero.png`**
  — quick-look renders on the brand's dark ground, for viewing outside a
  browser (most file previewers render SVG on white, where the chalk text
  disappears). Not logo files themselves — use the SVGs.

## How these were built

The wordmark and monogram are **outlined**, not `<text>` with a
`font-family`. The real Bungee-Regular glyph paths were extracted straight
from Google Fonts' own TTF with `fontTools` (`SVGPathPen` + `BoundsPen`),
y-flipped into SVG space, and laid out by hand at the font's own advance
widths. That means these files have zero runtime font dependency — no
`@font-face`, no network request, no risk of a fallback font rendering if
Bungee fails to load. They'll look identical wherever they're dropped,
including a plain `<img>` or a design tool that doesn't have Bungee
installed.

## Palette used

`#150a2b` (ground) · `#211141` (badge gradient) · `#9b3ff0` (purple, hero
glow only) · `#f6f1ff` (chalk) · `#ffd23f` (marquee yellow) — matches the
Neon Marquee concept deck's token names exactly.
