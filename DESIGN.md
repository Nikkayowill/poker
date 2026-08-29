---
name: StackChips
description: Six-max Texas Hold'em, PvP duels, and cribbage tables played with Gold — an in-app currency with no cash value.
colors:
  brand-ink: "#150a2b"
  brand-ink-lift: "#211141"
  brand-ink-lift-2: "#2c1854"
  neon-purple: "#9b3ff0"
  neon-purple-bright: "#c07bff"
  neon-purple-deep: "#4a1c88"
  brand-gold: "#ffd23f"
  brand-gold-light: "#ffe98a"
  brand-red: "#dc1413"
  neon-chalk: "#f6f1ff"
  neon-muted: "#b6a6db"
  muted-slate: "#93a1bb"
  muted-slate-2: "#6f7b92"
  ink: "#edf3ee"
  felt: "#164f3a"
  gold-table: "#d9b85d"
typography:
  display:
    fontFamily: "Georgia, \"Times New Roman\", serif"
    fontWeight: 700
    letterSpacing: "-.03em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontWeight: 400
  label:
    fontSize: "11px"
    fontWeight: 750
    letterSpacing: ".15em"
rounded:
  xs: "3px"
  sm: "5px"
  md: "7px"
  lg: "9px"
  xl: "12px"
  2xl: "14px"
  card: "8px"
  control: "8px"
  pill: "999px"
  round: "50%"
spacing:
  1: "2px"
  2: "4px"
  3: "6px"
  4: "8px"
  5: "10px"
  6: "12px"
  7: "14px"
  8: "16px"
  10: "20px"
  12: "24px"
  14: "28px"
components:
  button-primary:
    backgroundColor: "linear-gradient(152deg, #ffe08f 0%, {colors.brand-gold-light} 38%, {colors.brand-gold} 74%, #a8760c 100%)"
    textColor: "#1c1305"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "48px"
  button-secondary:
    backgroundColor: "rgba(182, 166, 219, .085)"
    textColor: "#e9eef6"
    rounded: "{rounded.control}"
    height: "48px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "#9fadc5"
    rounded: "{rounded.control}"
    height: "48px"
  input:
    backgroundColor: "rgba(182, 166, 219, .055)"
    textColor: "#eef2f8"
    rounded: "{rounded.control}"
    height: "46px"
    padding: "0 15px"
---

# Design System: StackChips

## Overview

**Creative North Star: "The Neon Marquee"**

StackChips' chrome — every screen except the felt itself — reads as a room lit by a single
violet-and-gold sign in the dark: a deep violet-black ground, two soft out-of-focus glows bleeding
in from opposite corners, and gold reserved for the one thing on a screen you're actually meant to
press. It replaced an earlier "High Roller Arcade" chrome (blue-grey ground, a busier gold histogram
accent) on 2026-08-27 when the app's own mark was redrawn; the mark's palette is now the chrome's
palette, not the other way around.

The room is borderless by design. Older passes separated surfaces with 1px hairlines; the current
system separates them with raised fill, real shadow, and space, and stands a border in for an
`--accent-edge` inset ring plus `--accent-glow` when a surface needs to read as selected or focused.
Purple is spent as a line and a glow, never a fill — the one exception is a single segmented control's
active state and the focus ring, because "selected" is the one moment worth a saturated hit. Gold is
spent once per screen too, on the single primary action; everything else is quieter.

**The felt is not part of this system.** The poker table (`05-game-header.css` through
`09-action-bar.css`, plus `16-first-person.css`/`17-landscape.css`/`99-scene.css`) keeps its own
untouched green-felt-and-gold identity (`--felt`, `--gold`, `--ink`, `--muted`) and its own hand-tuned
lighting. Reaching for a `--brand-*` or `--neon-*` token inside those sheets is a mistake, not a
shortcut, and reaching for `--felt`/table gold in chrome is the same mistake in reverse.

**Key Characteristics:**
- Violet-black ground with two ambient corner glows (violet top-left, gold bottom-right), never a
  flat black or a re-tinted-per-surface wash.
- Borderless chrome — separation is fill + shadow + space, not hairlines.
- One saturated gold fill per screen, spent on the single primary action.
- Purple is a line and a glow — accents, selected states, focus rings — never a background wash.
- A serif display face (Georgia) for the wordmark and headlines, sans-serif (Inter) for everything
  functional.
- The table's green felt and gold are a deliberately separate, untouched visual world.

## Colors

The palette is two glows and a ground, not a swatch board — most colors on a given chrome screen are
variations in opacity of the same three hues (violet, gold, near-black) rather than distinct colors.

### Primary
- **Neon Purple** (`#9b3ff0` / `--neon-purple`, aliased as `--brand-purple`): the accent line, glow,
  and the segmented control's one selected-state fill. Never a wash across a whole surface.
- **Neon Purple Bright** (`#c07bff` / `--neon-purple-bright`): the lighter step in the purple ramp,
  used where the deep purple alone would read too dark against the violet-black ground.
- **Neon Purple Deep** (`#4a1c88` / `--neon-purple-deep`, aliased as `--brand-purple-deep`): the dark
  end of the same gradient pair as Neon Purple, used together as a two-stop linear-gradient fill
  (e.g. the segmented control's active tab).

### Secondary
- **Brand Gold** (`#ffd23f` / `--neon-yellow`, aliased as `--brand-gold`): the one saturated fill a
  screen is allowed — primary CTA buttons, the active stakes tier, the active bottom-nav icon's glow.
- **Brand Gold Light** (`#ffe98a` / `--neon-yellow-bright`, aliased as `--brand-gold-light`): the top
  stop of the primary-button bevel gradient and the color secondary gold text (labels, active nav
  text) takes instead of the fully saturated value.

### Tertiary
- **Brand Red** (`#dc1413`): a trace, not a third light. The mark itself has no red, so this kept its
  pre-reskin value; used sparingly (a corner radial at ~5% alpha in `--brand-room`, the destructive
  menu-item state), never as a wash — three competing hues on a dark page goes muddy.

### Neutral
- **Neon Ground** (`#150a2b` / `--neon-ground`, aliased as `--brand-ink`): the page background behind
  every chrome screen — the literal is restated on `html`/`body` directly (not `var()`) so a failed
  custom-property resolution can't leave the PWA transparent to the OS behind it.
- **Neon Ground Lift** (`#211141`) / **Neon Ground Lift 2** (`#2c1854`): the ground's own lighter
  steps, used for panels and lifted surfaces — a tile reads as a lighter piece of the same room, not
  a translucent sheet laid over it.
- **Neon Chalk** (`#f6f1ff` / `--neon-chalk`): near-white, used sparingly against the violet ground.
- **Ink** (`#edf3ee` / `--ink`): the default body text color app-wide (also the felt's own text color
  — one of the few tokens both worlds share, because plain readable text isn't a brand decision).
- **Muted (violet)** (`#b6a6db` / `--neon-muted`, `#8a7ab3` / `--neon-muted-2`): secondary chrome text
  in the Neon Marquee's own hue. Barely adopted in practice — see the next entry.
- **Muted (slate)** (`#93a1bb` / `--muted-slate`, `#6f7b92` / `--muted-slate-2`): a second, older
  muted-text family, cool blue-slate rather than violet, that predates the 2026-08-27 reskin and was
  never migrated. An audit found it hand-written as bare hex in 8 stylesheets and ~48 places (sign-in,
  arcade, duels, collection, panels, the mobile shell…), several of them near-duplicates of each other
  by a few RGB units — making it the app's actual most-used muted-text convention, well ahead of the
  violet pair above. Named here as real load-bearing tokens rather than left as undocumented literals;
  reconciling it with `--neon-muted`/`-2` into one family is a separate, deliberate call this doesn't
  make on its own.

### Named Rules
**The One Light Rule.** Violet and gold come from the two ambient glows layered over the ground,
never from re-tinting the ground itself per surface. A tinted ground plus per-surface violet fills is
mud regardless of which hue the ground is.

**The Single Fill Rule.** A saturated color fill (full-strength purple or gold, not the muted/lift
steps) is spent at most once per screen, on the one thing that's actually the primary action or the
current selection. Everywhere else takes `--accent-edge`/`--accent-glow` instead.

## Typography

**Display Font:** Georgia (with "Times New Roman", serif)
**Body Font:** Inter (with ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
sans-serif)

**Character:** A newspaper-headline serif dropped into an otherwise plain, functional sans-serif
interface — the serif is reserved for the wordmark, page headlines, and tile titles that want a
little editorial weight; nothing else touches it.

### Hierarchy
- **Display** (700, `clamp(26px, 3.9vw, 34px)`, 1.06 line-height, Georgia, -.03em tracking): the
  sign-in headline and the wordmark itself.
- **Title** (600, ~15.5px, Georgia): tile titles in the mobile lobby shell (`.mshell-tile strong`) —
  the one place outside the headline the serif is used for a functional label, not just branding.
- **Body** (400–600, 14–16px, Inter): form fields, row/tile descriptions, nav labels.
- **Label** (750, 11px, .15em tracking, uppercase): field labels and small kickers — deliberately the
  most emphatic weight at the smallest size, so a label reads as structure, not content.

### Named Rules
**The One Serif Rule.** Georgia appears only where something is being named or introduced (the
wordmark, a page headline, a tile's own title) — never on body copy, buttons, or anything functional.

## Layout

Stylesheets are numbered and load in that fixed order (`01-tokens.css` … `99-scene.css`); a change
must preserve that order, and each number is a stable identity other files' comments point back to.
`12-responsive.css` centralizes most breakpoint overrides, though a handful of self-contained sheets
(`20-menu.css`, `45-mobile-shell.css`) keep their own responsive rules instead of splitting across
files.

Four safe-area inset tokens (`--safe-top/right/bottom/left`) stand in for `env(safe-area-inset-*)`
everywhere, specifically so tests can override them — `env()` always reads 0 outside a real notched
device, which is why the lobby header, the sign-in screen, and the bottom nav all key off these
tokens instead of the raw `env()` call. The lobby header height is a single token
(`--lobby-header-h`, 82px) three separate rules agree against; the in-game header keeps its own
separate ladder (`--game-header-h`, 68px stepping down through 42/34) because it steps down at
different breakpoints.

The mobile lobby shell (`.mshell`) is a horizontally-paged three-tab layout (Texas Hold'em / Ante Up /
Profile) with a fixed bottom tab bar (`.mshell-nav`) rather than a scrolling single column — the bar
is `position: fixed` against the true viewport rather than sized by the shell's own `100dvh`, because
an installed iOS PWA's standalone `dvh` measures short of the real screen bottom.

## Elevation & Depth

Chrome depth is conveyed by two soft ambient radial-gradient glows plus tonal lift steps
(`--brand-ink` → `--brand-ink-lift` → `--brand-ink-lift-2`), not by a shadow system doing the work
alone — a raised chrome surface is a lighter tint of the same ground plus a real shadow, not a
floating card with a border. A five-step shadow scale (`--elevation-1` through `--elevation-5`) exists
for surfaces that do lift off the room (the dropdown menu, the primary button's own glow shadow).

### Shadow Vocabulary
- **elevation-1** (`0 2px 4px rgba(0,0,0,.4)`): the lightest lift, barely off the surface below.
- **elevation-2 / elevation-3** (`0 6px 14px rgba(0,0,0,.3)` / `0 8px 18px rgba(0,0,0,.35)`): a raised
  row or tile.
- **elevation-4** (`0 15px 35px rgba(0,0,0,.22)`): a floating panel (the dropdown menu uses a similar
  hand-tuned value, `0 20px 50px rgba(0,0,0,.55)`).
- **elevation-5** (`0 40px 120px rgba(0,0,0,.5)`): the deepest lift in the scale.
- **Gold glow** (`0 16px 38px rgba(255,210,63,.3), inset 0 1px rgba(255,255,255,.45)`): the primary
  button's own signature — a colored shadow plus an inset top-face highlight, read as a bevel rather
  than a flat filled rectangle.

### Named Rules
**The Glow-Not-Border Rule.** A selected or focused chrome surface gets `--accent-edge` (an inset
ring) and `--accent-glow` (a colored shadow) instead of a visible border — the accent is light thrown
from an edge, not a line drawn around one.

## Shapes

Two radius scales coexist by design: a fine eight-step scale (`--radius-xs` 3px through `--radius-2xl`
14px, plus `--radius-pill` and `--radius-round`) that the table sheets still use directly, and the
chrome's own two working radii — `--radius-card` and `--radius-control`, both deliberately 8px. Kept
as two separate names rather than one shared token because they're two decisions that could diverge
later (e.g. pill-shaped controls on square cards), even though they currently match.

### Named Rules
**The Two Radii Rule.** Outside the table, everything is one of exactly two radii: `--radius-card` for
a surface, `--radius-control` for anything interactive. A screen mixing more radius values than that
is drifting back toward the pre-reskin chrome, which mixed four.

**Concentric Radii.** A control nested inside a padded track (the segmented control, its container)
grows the outer radius by its own padding rather than shrinking the inner control below the shared
value — two boxes sharing one radius across a visible gap reads as the boxes fighting.

## Components

### Buttons
- **Shape:** `--radius-control` (8px), 46–52px tall depending on surface.
- **Primary:** a warm gold bevel gradient (`linear-gradient(152deg, #ffe08f 0%, --brand-gold-light
  38%, --brand-gold 74%, #a8760c 100%)`), dark ink text (`#1c1305`), a colored drop shadow plus an
  inset top highlight. This is the one saturated fill per screen.
- **Secondary (OAuth):** a flat `--brand-surface-2` fill, light text — one step quieter than primary.
- **Ghost (guest / tertiary):** transparent at rest, takes `--brand-surface` only on hover.
- **Hover / Focus:** primary brightens and lifts 1px; every button variant takes `--brand-focus`
  (a two-ring box-shadow: dark ring then gold-light ring) on `:focus-visible`, never an outline.

### Segmented control
- **Style:** a padded track (`--brand-surface` fill, radius = `--radius-control` + 4px) containing
  borderless buttons; the active option takes the purple gradient fill plus `--accent-glow`.

### Inputs / Fields
- **Style:** filled surface (`--brand-surface`), no border, `--radius-control` corners, 46px tall,
  16px font (keeps iOS from auto-zooming on focus).
- **Focus:** background steps to `--brand-surface-2` plus a 1px accent-line ring and `--accent-glow` —
  the glow-not-border pattern applied to a field.
- **Label:** uppercase, 11px, 750 weight, .15em tracking — small and heavy rather than large and light.

### Toggle switch
- **Style:** a 42×24px pill track, translating a shadowed 18px thumb; unchecked track is a flat white
  wash, checked track takes the purple→red brand gradient. Used instead of a checkbox wherever the
  choice is a single boolean.

### Bottom navigation (mobile)
- **Style:** three equal columns, fixed to the true viewport bottom, translucent dark fill
  (`rgba(22,27,38,.94)`) with a backdrop blur where supported, a hairline top shadow instead of a
  border. A 44px hit-target floor per item (TikTok/Quora's own bar height, not a taller Material bar).
  The active tab's icon and label both shift to `--brand-gold-light`, and the active icon alone gets a
  small gold drop-shadow so the current tab reads at a glance.

### Tiles / rows
- **Style:** borderless, transparent-until-pressed; a press scales the element to `.985` rather than
  changing its background. Tile titles use the display serif at ~15.5px; row/tile secondary text is
  11–11.5px, `#93a1bb`.

### Dropdown menu
- **Style:** a `--radius-2xl` (14px) panel, flat dark fill (`#16121f`), a deep ambient shadow instead
  of a border, items highlight with a translucent white wash on hover and an inset purple ring on
  keyboard focus. Disabled items use `aria-disabled`, not `:disabled`, so they stay in the arrow-key
  ring.

## Do's and Don'ts

### Do:
- **Do** treat purple as a line and a glow (`--accent-line`, `--accent-edge`, `--accent-glow`) —
  reach for it on a border-color or box-shadow, not a `background`.
- **Do** spend the one saturated gold fill on the actual primary action of the screen, and nothing
  else on that screen.
- **Do** use `--radius-control`/`--radius-card` (both 8px) for every chrome surface; reserve the finer
  `--radius-xs`…`--radius-2xl` ladder for the table sheets that already use it directly.
- **Do** use Georgia only for the wordmark, a page headline, or a tile's own title — Inter for
  everything else.

### Don't:
- **Don't** fill a whole chrome surface with `--brand-purple`/`--neon-purple` — one such element per
  screen reads as emphasis, six reads as a theme, and the eye stops finding what's actually
  actionable.
- **Don't** add a visible 1px border to a chrome surface. Use `--accent-edge` (inset ring) for an
  outline-like accent, or `--rule` (a hairline that fades at both ends) for a divider between two
  things — never the outline of one.
- **Don't** reach for `--brand-*`/`--neon-*` tokens inside `05-09`, `16`, `17`, or `99` (the table
  sheets), or for `--felt`/table gold outside them. The felt and the chrome are deliberately separate
  visual worlds.
- **Don't** hand-write a new muted-gray literal in any of the three existing families (`--muted`
  greenish, `--muted-slate`/`--muted-slate-2` blue-slate, `--neon-muted`/`--neon-muted-2` violet) —
  reach for the token that already matches the surface's hue, or treat reconciling the three families
  into one as its own deliberate cleanup rather than adding a fourth near-duplicate to the pile.
