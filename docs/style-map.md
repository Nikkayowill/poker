# Where things live — a style map for manual tweaks

This is for hand-editing layout (card sizes, seat positions, table shape,
colors) without going through AI. It's a map, not a tutorial — open the file,
find the rule, change the number, reload.

## The big picture

```
components  →  app/api  →  lib/game  →  lib/server  →  memory | Supabase
```

For **visual** stuff specifically, ignore most of that — you mostly need two
folders:

- `app/styles/` — all CSS, split into ~40 numbered files, imported in order
  by `app/globals.css`. The number is load order, not importance: a rule in
  `12-responsive.css` can override one in `06-table.css` because it loads
  later, and moving a file earlier/later in `globals.css` can silently break
  things. **Don't renumber files** — add new ones at the next free number.
- `lib/game/table-geometry.ts` and `lib/scene/scene-config.ts` — a handful of
  layouts (where seats sit around the table, the 2.5D canvas room) are
  computed as **JavaScript constants**, not CSS. If a number "isn't in the
  CSS anywhere," it's probably one of these two files.

## Cards

- **Shape/size**: `app/styles/07-cards.css`
  - `.card-large` — hole cards / community cards. Sized with
    `clamp(68px, 7.4vw, 88px)` — that's (min, preferred, max), so bumping the
    `88px` grows cards on wide screens, `68px` on narrow ones.
  - `.card-small` — the tiny cards used in hand-history / muck previews.
  - `.card-index`, `.card-suit-large` — the rank/suit glyphs inside a card,
    sized in `cqw` (container query width) so they scale with the card
    itself — you basically never need to touch these directly.
  - The suit shapes (♠♥♦♣) are inline SVG paths in
    `components/table/playing-card.tsx`, not CSS.
- **Where cards sit**:
  - Hole cards: inside `.player-seat` / `.seat-cards`, so they move with the
    seat (see below) — you don't position a card, you position its seat.
  - Community cards (the board): `.community-cards` / `.board-stack` in
    `app/styles/06-table.css` (~line 542 and ~line 323). `.board-stack` is
    the centred column that holds "Pot" + the five cards; it's pinned with
    `left: 50%; top: 48%; transform: translate(-50%, -50%)`. Nudge `top:
    48%` to move the whole board+pot stack up or down.

## Seats (where players sit)

- **Ring math (the actual X/Y position of each seat)**:
  `lib/game/table-geometry.ts`. This is TypeScript, not CSS — the seats sit
  on an ellipse, and this file has separate radius constants for desktop,
  narrow phones, portrait phones, and landscape phones:
  `RADIUS_X`/`RADIUS_Y`, `NARROW_RADIUS_X`, `PORTRAIT_RADIUS_X`/`_Y`,
  `LANDSCAPE_*`. Each constant has a comment explaining why it's the value
  it is (usually "avatar clipped the header at X, so it's Y now") — read the
  comment before changing the number, it'll tell you what breaks.
- **Seat appearance** (the figure, nameplate, cards, pills):
  `app/styles/08-seat.css`. Key selectors:
  - `.player-seat` — the positioned box itself (`position: absolute`).
  - `.seat-figure` — the avatar art.
  - `.seat-plate` — the name/stack pill under the figure.
  - `.seat-cards` — z-index only; actual card size comes from 07-cards.css.
  - `.seat-current`, `.seat-away`, `.seat-muted`, `.seat-winner` — state
    variants (whose turn, sitting out, folded, won the hand).

## Table felt, rail, pot, HUD

All in `app/styles/06-table.css`:
- `.poker-table-wrap` — the outer table box.
- `.poker-rail` — the wooden/dark rail ring around the felt.
- `.poker-felt` — the green playing surface itself.
- `.pot-anchor` / `.board-stack` / `.center-pot-amount` — pot position and
  the "Pot $X" label (see Cards section above).
- `.table-hud`, `.table-feed`, `.blind-structure` — the on-table info
  overlays (action feed, blind timer).

## Action bar (fold/call/raise buttons)

`app/styles/09-action-bar.css` and `components/table/action-bar.tsx`.

## Responsive breakpoints

`app/styles/12-responsive.css` is where phone/tablet/desktop overrides live
— it loads **last** among the layout files on purpose, so it can win against
`06-table.css`/`07-cards.css`/`08-seat.css`. If a change works on desktop but
not on your phone (or vice versa), the override fighting you is probably in
here. Search for the selector you just edited — there's likely a
`@media (max-width: ...)` block for it further down this same file.

## Colors / spacing tokens

`app/styles/01-tokens.css` — CSS custom properties (`--ink`, `--gold`,
`--felt`, `--brand-purple`, etc). Two palettes live side by side on purpose:
- `--felt`, `--gold`, `--surface` etc → the **game itself** (table, chips,
  cards). Stays green felt + gold, deliberately untouched by the chrome
  reskin.
- `--brand-*` → the **chrome** (lobby, menus, sign-in, everything that isn't
  the table). Don't reach for a `--brand-*` token inside 05–09, 16, 17, or 99
  — those files are the game.

## The three table renderers

There isn't one table drawing — there are three, picked by player
preference (`lib/scene/table-renderer.ts`), and cards/seats/HUD are the
*same DOM* laid over whichever one is underneath:
1. **Flat CSS table** — just the files above, a painted felt image.
2. **2.5D canvas** — `lib/scene/scene-config.ts`, `lib/scene/seat-ring.ts`,
   `lib/scene/projection.ts` draw a tilted-camera room on `<canvas>` behind
   the same DOM seats/cards. If you're chasing a number for this renderer
   specifically, it's in `lib/scene/`, not `app/styles/`.
3. **3D room** — `components/game3d/`, `lib/game3d/` — full rigged
   character models. Much more involved to hand-edit (avatar rigging, arm
   IK, camera framing); not really a "change a CSS number" surface.

If you only ever play with the default flat/2.5D look, you can ignore
`lib/game3d/` entirely.

## Quick cheatsheet

| I want to... | Edit |
|---|---|
| Make cards bigger/smaller | `app/styles/07-cards.css` → `.card-large` / `.card-small` |
| Move the pot / board up or down | `app/styles/06-table.css` → `.board-stack` `top: 48%` |
| Move seats closer/further from center | `lib/game/table-geometry.ts` → `RADIUS_X` / `RADIUS_Y` (and the phone variants) |
| Change the felt/rail color or image | `app/styles/06-table.css` → `.poker-felt`, `.poker-rail` |
| Change a color everywhere at once | `app/styles/01-tokens.css` |
| Fix something that's only wrong on phone | `app/styles/12-responsive.css` (search for the selector) |
| Change the action bar buttons | `app/styles/09-action-bar.css` |
| Change the 2.5D canvas room's camera/seat ring | `lib/scene/scene-config.ts`, `lib/scene/seat-ring.ts`, `lib/scene/projection.ts` |

## Two easy ways to break the whole stylesheet

- **An unbalanced `/* */` comment.** One unclosed comment block in *any*
  numbered CSS file kills the entire cascade silently (PostCSS drops it,
  and neither `tsc` nor eslint reads CSS). If styling suddenly looks totally
  broken after an edit, check you closed every `/*` you opened.
- **Reordering `app/globals.css`'s `@import` list.** The numbers are load
  order. `12-responsive.css` and `99-scene.css` in particular are pinned
  near/at the end on purpose — moving them earlier makes their overrides
  stop winning.

Run `npm test` after a change if you touched anything structural —
`stylesheets.test.ts` specifically guards against the unbalanced-comment
trap above.
