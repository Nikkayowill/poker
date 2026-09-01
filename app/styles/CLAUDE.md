# Styling contract

Migrated from the root `CLAUDE.md` (2026-08-17) — loads only when working under this directory.

- Chrome (everything except the table) is borderless: separation comes from a raised fill, real
  shadow, and space — not 1px hairline borders. `--accent-edge` (inset ring) + `--accent-glow` stand
  in for a border; `--rule` is the one fading-hairline token for dividers between items (never an
  outline around one).
- Palette (2026-08-27): violet-black ground (`--brand-ink` `#150a2b`), brand purple/gold
  (`#9b3ff0`/`#ffd23f`) now resolve to the current mark's own Neon Marquee palette (`--neon-*` in
  `01-tokens.css`), reserved for chrome accents and single primary actions, not a wash across a whole
  surface. `--brand-red` (`#dc1413`) is unchanged — the mark has no red, so it kept its old value and
  stays a trace, never a wash. Table felt/gold (`05-game-header.css` through `09-action-bar.css`, plus
  `16`/`17`/`99`) is untouched green felt and out of scope for chrome work.
- A custom property whose value is a `calc()` over *another* custom property resolves that calc
  against **the element it is declared on**, and descendants inherit the already-resolved value — it
  does not re-resolve against a closer override. So a `--step: calc(var(--cell) * .66)` on a wrapper
  will keep using the wrapper's own `--cell` even when a child sets `--cell` inline. Declare the
  derived property on the same element that carries the value it derives from. This shipped as a real
  bug in `50-nonogram.css` (2026-09-01): the clue gutter kept a 24px fallback at every board size and
  clipped the top number off every two-deep column clue, which makes a nonogram unsolvable rather than
  untidy.
- A single unbalanced CSS block comment silently kills the **entire** stylesheet — PostCSS drops it,
  and neither tsc nor eslint reads CSS. `stylesheets.test.ts` guards against an orphaned comment
  delimiter.

## Where table positioning actually lives (2026-08-26)

The racetrack (`racetrack_2d5`) is the only live table (see `lib/scene/CLAUDE.md`). It is
camera-led, not CSS-led: the scene solves a perspective camera and reports real pixel anchors, and
the DOM (nameplates, cards, bets, board, dealer) is positioned FROM those anchors rather than from
independently-tuned CSS percentages. That means each surface has exactly one real source of truth,
even though the codebase still carries pre-scene-ready CSS fallbacks (and, on older sheets, plain
dead weight from the deleted classic table) that can look like a second live system if you don't
know to skip past them. This table exists so you don't have to re-discover that by grepping:

| Surface | Real source of truth | What the CSS does with it |
|---|---|---|
| A seat's bet label / chip pile | `lib/scene/table-anchors.ts` — `CHIP_INSET_PER_SEAT`, `CHIP_OFFSET_PER_SEAT` (per-seat, in metres) | `42-racetrack-table.css`'s `.table-bet` overrides read `--bet-dx-px`/`--bet-dy-px` (opponents) or `--bet-x-rel-px`/`--bet-y-rel-px` (your own seat), both set inline by `poker-table.tsx` from the scene's projection |
| A seat's position on the ring | `racetrack-scene.tsx`'s camera fit (via `fitCamera`, not a CSS constant) | `poker-table.tsx` sets `--seat-x`/`--seat-y` per seat inline; `lib/game/table-geometry.ts`'s CSS ellipse is a pre-layout first-frame fallback only, not the real position |
| The pot | `lib/scene/table-anchors.ts` — `potAnchor()`, `POT_DEPTH_FRACTION` (0.74 of the felt's half-width, never centre) | Same inline-anchor pattern as the board below |
| The community card row's size | `lib/scene/table-anchors.ts` (`RACETRACK_BOARD_CARD_MIN/MAX_PX`) then shrunk further by `lib/scene/board-clearance.ts`'s `clampBoardCardWidth`, every frame, until it clears the live gap to the pot | `.scene-room-racetrack .community-cards` in `42-racetrack-table.css`, sized from the same projection |
| The street/blinds caption under the board | Static offset, not projected | `.scene-room-racetrack .board-caption` in `42-racetrack-table.css` (a flat `translateY`, tunable directly) |
| The dealer (Claira) | `lib/scene/table-dealer.ts` — `DEALER_SLOT`, `dealerSlotBox()` | `poker-table.tsx`'s `dealerStyle`; see its own doc block in `42-racetrack-table.css` |
| A seat's own nameplate/blind pill layout (SB/BB, name, stack) | Ordinary CSS flow, no coordinates involved | `08-seat.css`'s `.seat-plate`/`.seat-name-row`/`.blind-label` — this one genuinely IS "just CSS," edit it directly |

**The trap**: `08-seat.css`'s base `.table-bet` rule and its breakpoint overrides in
`12-responsive.css`/`16-first-person.css`/`17-landscape.css` (the `--bet-reach-x`/`--bet-reach-y`
custom properties) look like a second positioning system, and read as a natural place to tune a bet
label. They aren't — the racetrack room overrides `.table-bet`'s `left`/`top`/`transform` outright
once its scene reports ready, so those variables only ever paint for the one frame before that (or
if the scene never becomes ready). They're pre-scene-ready fallbacks, left in place rather than
deleted since the risk of losing a real degraded-state fallback outweighed the clutter. Each of
those rules now carries a comment saying so and pointing back here — if you land on one while
looking for where a bet label's real position is, that comment is confirming you're in the wrong
file, not a dead end.
