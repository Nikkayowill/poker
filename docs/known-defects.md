# Known defects

Reproducible bugs that are understood but deliberately not fixed yet, with the
milestone that owns the fix. A defect leaves this file when its fix lands and
a test asserts the corrected behaviour.

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
