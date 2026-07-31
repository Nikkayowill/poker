# Known defects

Reproducible bugs that are understood but deliberately not fixed yet, with the
milestone that owns the fix. A defect leaves this file when its fix lands and
a test asserts the corrected behaviour.

---

## D1 — Local nameplate is overlapped by the action bar at 390×844

**Found:** 2026-07-31, during M1. **Owner:** M5 (action bar rebuild). **Severity:** high — the affected state is "it is your turn on a phone", the most common state in mobile play.

At mobile portrait the local player's nameplate renders *inside* the action bar
rather than above it. Measured: plate bottom `666.44`, action bar top `614` —
a 52px overlap.

### Why it happens

`.poker-table-wrap` sizes itself from a fixed reserve in `app/styles/06-table.css`:

    width: min(980px, 100%, calc((100dvh - var(--table-reserve)) * var(--table-aspect)))

At 390×844 the responsive block sets `--table-aspect: 0.62` while
`--table-reserve` stays at its base `254px`, giving:

    width  = min(980, 384, (844 - 254) * 0.62) = 365.8px
    height = 365.8 / 0.62                      = 590px

With the 56px mobile header the table's bottom edge lands at **646**.

`components/table/poker-table.tsx` then measures how far the foreground seat
hangs below the felt:

    setForegroundDrop(Math.max(0, Math.round(barTop - rect.bottom - 6)))

The expanded your-turn bar (countdown, time gems, fold/check/call, raise
slider, commit row) occupies 230px, so `barTop` is 614 — *above* the table's
own bottom edge. The expression goes negative, clamps to `0`, and the seat
sits flush at the felt's bottom with its nameplate extending to 666, i.e.
52px into the controls.

The root cause is the reserve itself: header (56) + expanded bar (230) = **286px
actually needed** against a **254px** reserve. `--table-reserve` is not
overridden in the `max-width: 600px` block, so mobile portrait inherits a value
computed for a shorter bar.

### Reproducing

Not reachable through `tests/e2e/visual-layering.spec.ts` any more — that spec
was made hermetic in the same change that found this, and a freshly created
table rarely has the local player on turn at measurement time. To reproduce,
open a 390×844 table, wait until it is your turn with the raise control
visible, and compare `.seat-plate` against `.action-bar`:

    plate.getBoundingClientRect().bottom <= bar.getBoundingClientRect().top

### Notes for M5

- Do not fix by shrinking the nameplate. The reserve is the broken number.
- `--table-reserve` needs a mobile-portrait value that covers the *expanded*
  bar, not the waiting bar — or the bar needs a fixed height, which M5 is
  introducing anyway ("buttons should never move").
- Whatever lands, add the plate-vs-bar assertion to a test that actually puts
  the local player on turn, otherwise this regresses silently.
