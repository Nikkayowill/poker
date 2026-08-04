# Known defects

Reproducible bugs that are understood but deliberately not fixed yet, with the
milestone that owns the fix. A defect leaves this file when its fix lands and
a test asserts the corrected behaviour.

Two kinds of entry are kept rather than deleted, and are marked as such in
their heading: CLOSED, where the fix landed and a named test holds it, and
WITHDRAWN, where measurement showed there was no defect. Both are retained
because the reasoning that produced them is the part worth having — a wrong
diagnosis that gets deleted is one somebody repeats.

---

## D1 — Local nameplate is overlapped by the action bar at 390×844 — CLOSED

**Closed:** 2026-07-31. Fixed in M5 (`942f4fb`), which made the action bar a
fixed height and gave every `.poker-table-wrap` width override a
`--table-height-cap` term, and again in the playtest fixes (`bc6b2a1`), which
added `--foreground-allowance` for the part of the seat that hangs below the
felt. Asserted by `tests/e2e/action-bar.spec.ts:103`, which puts the local
player on turn with the raise drawer open and compares `.seat-plate` against
`.action-bar` -- the test the notes below asked for. Kept in full because the
diagnosis is the useful part: the first version of this entry was wrong, and
the way it was wrong recurs.

**Found:** 2026-07-31, during M1. **Owner:** M5 (action bar rebuild). **Severity:** high — the affected state is "it is your turn on a phone", the most common state in mobile play.

At mobile portrait the local player's nameplate renders *inside* the action bar
rather than above it. Measured: plate bottom `666.44`, action bar top `614` —
a 52px overlap.

### Why it happens

Corrected 2026-07-31. The first version of this entry blamed `--table-reserve`
for being too small. That was wrong in a way worth recording: **the reserve is
never applied at this viewport at all.**

`.poker-table-wrap` has four width rules across three files, and only the base
carries a height term:

| load order | rule | caps by height? |
|---|---|---|
| `06-table.css:45` | `min(980px, 100%, calc((100dvh - var(--table-reserve)) * var(--table-aspect)))` | yes |
| `11-panels.css` @max-1020 | `min(780px, calc(100% - 40px))` | no |
| `11-panels.css` @max-800 | `calc(100% - 24px)` | no |
| `12-responsive.css` @max-600 | `calc(100% - 6px)` | no |

Each override replaces the whole `min()`, so below 1021px the table is sized
purely from available *width* and may end up any height at all. At 390x844:

    content width = 390 - 8 (.table-area padding) = 382
    width         = calc(100% - 6px)              = 376
    height        = 376 / 0.62 (--table-aspect)   = 606.5
    table bottom  = 56 (header) + 4 (padding) + 606.5 = 666.5

`components/table/poker-table.tsx` then measures the foreground seat's drop:

    setForegroundDrop(Math.max(0, Math.round(barTop - rect.bottom - 6)))

The expanded your-turn bar occupies 230px, putting `barTop` at 614 -- above the
table's own bottom edge -- so the expression goes negative, clamps to 0, and the
nameplate lands at 666.5 against a measured 666.44. That arithmetic closes; the
first version's did not, and deriving 646 from a formula that never runs here is
exactly the error to avoid repeating.

### Reproducing

Not reachable through `tests/e2e/visual-layering.spec.ts` any more — that spec
was made hermetic in the same change that found this, and a freshly created
table rarely has the local player on turn at measurement time. To reproduce,
open a 390×844 table, wait until it is your turn with the raise control
visible, and compare `.seat-plate` against `.action-bar`:

    plate.getBoundingClientRect().bottom <= bar.getBoundingClientRect().top

### Notes for M5

- Do not fix by shrinking the nameplate, and do not fix by only raising
  `--table-reserve`: that variable is inert below 1021px, so changing it moves
  nothing at the viewport this defect is about.
- The fix is that every width override has to keep a height term. Any rule that
  replaces the base `min()` with a width-only value re-opens this, at whatever
  breakpoint it applies to. The tablet range (601-1020px) has the same hole and
  is only saved by having more vertical room to waste.
- The bar getting a fixed height ("buttons should never move", which M5 is
  introducing anyway) makes the height term computable instead of guessed.
- Whatever lands, add the plate-vs-bar assertion to a test that actually puts
  the local player on turn, otherwise this regresses silently.

### Why this blocks part of M3

Inverting `11-panels.css`'s two `.poker-table-wrap` rules to mobile-first means
deciding what the base width formula is -- which is the same decision as fixing
this defect. Doing it as a pure refactor first would move those rules once for
the inversion and again for the fix, and the intermediate state has the height
cap in a different place at every breakpoint. Left for M5 to do once.

## D2 — WITHDRAWN: the 10:30 seat does not collide with the live feed

Recorded on 2026-08-04 as a blocker on eight-max seating, then measured and
withdrawn the same day. **There is no defect here.** Kept rather than deleted
because the reasoning that produced it is easy to repeat.

The claim was that an eight-seat ring introduces a seat at 10:30 which lands
under `.table-feed` on a phone, and that the feed would have to move before
`SEAT_COUNT` could change. The arithmetic behind it mixed two coordinate
spaces: the seat position was computed relative to `.poker-table-wrap` (y=61
inside the table box) and compared against a feed position measured from the
top of the viewport. Those share no origin.

Measured in Chromium at the feed's true maximum height -- three entries, which
is all `poker-table.tsx` ever renders (`game.log.slice(0, 3)`), with the
stylesheet's own per-viewport wrapping and hiding applied:

    viewport          feed bottom   8-max 10:30 seat top   clearance
    desktop  1440x900       179.3                  207.0      27.7px
    portrait  390x844       138.2                  183.6      45.4px
    landscape 844x390        65.4                   99.0      33.6px

The feed never reaches the ring because it never reaches the table. It lives in
`.table-hud`, which is a sibling of `.poker-table-wrap` and sits above it: on
the portrait phone the feed ends at y=101.6 and the wrap does not begin until
y=107.

`tests/e2e/table-feed.spec.ts` now holds this as a measured guard on all three
viewports, with a 16px minimum on the gap rather than a bare non-overlap
assertion. It computes the 10:30 rectangle from the same constants
`lib/game/table-geometry.ts` uses, because `SEAT_COUNT` is still 6 and there is
no such seat in the DOM to measure -- which is also why the older assertion in
that file, which measures real `.player-seat` boxes, cannot catch this class of
problem on its own.

Two things that are worth keeping from the original note, because they are
true: eight-max geometry is otherwise ready (`seatGeometry` is parametric and
`lib/game/table-geometry.test.ts` locks the eight clock positions), and
`seatWidthFor` takes a count so adjacent seats keep their spacing at eight. The
remaining blocker on eight-max is not layout at all -- it is `SEAT_COUNT`, the
`MAX_SEATS` assertion in the table manager, and the live `seat_number between 1
and 6` constraint on `cash_game_sessions`.
