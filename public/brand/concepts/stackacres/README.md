# StackAcres — wordmark

The farm game's real name, replacing "StackChips Homestead" (and the "the
Homestead" signature that briefly stood in for it). Kayo's call: a
portmanteau of StackChips' own "Stack" and the farm's "Acres" reads as its
own game on the floor -- distinct from the wager games -- while the shared
"Stack" keeps it legibly part of the same family, the way "StackChips"
itself does for the app as a whole.

## What's here

- **`wordmark.svg`** — the whole lockup, one line: **STACK** in chalk
  (`#f6f1ff`), **ACRES** in marquee yellow (`#ffd23f`), same two-tone split
  the main StackChips wordmark uses (STACK / CHIPS), tilted -2° to match.
  `components/brand/stackacres-logo.tsx` is the live component built from
  this file.
- **`preview-on-dark.png`** — quick-look render on the brand's dark ground,
  same reason every other concept folder keeps one (most file previewers
  render SVG on white, where the chalk half disappears).

## How it was built

Same technique as the StackChips wordmark and the Homestead signature before
it: outlined straight from the real **Bungee-Regular** TTF with `fontTools`
(`SVGPathPen` off a resolved `glyphSet`, not the raw `glyf` table -- Bungee's
`A` is a composite glyph and raw-table drawing chokes on components; a
`TransformPen` bakes each glyph's own x-advance in rather than composing a
group transform per glyph). Confirmed byte-identical to the shipped
StackChips wordmark's own "Stack" path before this was trusted -- same font,
same build. Zero runtime font dependency: no `@font-face`, no network
request, nothing to go soft or swap to a fallback face.

No glow filter, unlike the sign-in hero variant of the main wordmark --
this needs to hold up at hub-tile and in-game-header size, and a blur
filter costs more there than it's worth (the same reasoning
`stackchips-logo.tsx`'s own header gives for its level `wordmark.svg`
sibling).

## Palette

`#f6f1ff` (chalk, STACK) · `#ffd23f` (marquee yellow, ACRES) -- the same two
colors every StackChips wordmark variant uses, no new tokens for the
sub-brand.
