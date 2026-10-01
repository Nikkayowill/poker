# StackAcres: the barn routine

What turns livestock from production slots into farm residents. Read
`docs/stackacres-direction.md` first; this is one feature inside it.

## Where Gold enters and where it leaves

Section 24 of the direction doc asks this before any code. The answer:

- **Gold leaves** in exactly one place: placing the Barn (18,000 Gold and 40 Wood, through the
  existing machine placement path). A sink, never sold back.
- **Gold enters** nowhere. The daily tend spends nothing and pays nothing. What it pays is extra
  **produce**, which reaches Gold only through a sale that is already under the daily Gold ceiling.

This is section 10's table taken literally. "Upgrade the barn for 10,000 Gold" is the good column;
"Pay Gold every time you feed an animal" is the bad one. Feeding is untouched, and tending is free.

## The pieces

**Names.** `animalNameFor(unitId, stock)` derives a stable name from the unit id by FNV-1a into a
per-kind pool. No column, no rename action, no user text to moderate. The client and the server
compute the same name, so an optimistic tend never flashes a second one.

**Status.** Four states, ordered by what to deal with first: `producing` (ready to collect),
`hungry` (frozen, the only one costing the player anything right now), `needs-attention` (the daily
tend is unclaimed, or a meal is due within `ATTENTION_LEAD_MS`), `content`. Derived from the same
unit snapshots the map draws, so the panel and the world cannot disagree.

**Moods.** Presentation only. Nothing reads a mood to decide anything, which is why it is allowed to
be softer than the status and to mention the streak.

**The daily tend.** One per animal per UTC day (`stackacresExchangeDay`, the boundary devotion,
friendship and the Feed Silo already share). It moves no clock at all — not `ready_at`, not
`last_fed_at` — so it can never stand in for feeding.

**Quality.** Consistent care adds produce to the batch the animal is already growing, the same lever
a serving of Spinach pulls. Nothing at 1–2 days, +1 from 3, +2 from 7.

**The Barn.** A twelfth machine kind. It widens every animal's hunger window by
`BARN_COMFORT_MULTIPLIER` and grants `BARN_CAPACITY_BONUS` free slots per livestock kind. Comfort and
room, never throughput: it does not touch `durationMs` or `yieldQuantity`.

**Ray.** A `cared` story event feeds the existing quest objective machinery. Three one-time gifts of
feed servings at streaks 3, 7 and 14 — feed, the animal loop's own currency, never Gold.

## The caps, and why each one holds

| Cap | Value | What makes it true |
|---|---|---|
| Care bonus per cycle | `CARE_BONUS_CAP` = 2 | Clamped in `applyCare`, again at the store write, and a `homestead_units_care_bonus_check` CHECK constraint besides. Stored in its own `care_bonus` column rather than shared with `feed_bonus`, so the cap can be asserted without also capping the Spinach bonus. |
| Care streak | `CARE_STREAK_CAP` = 30 | Clamped in `careStreakAfter` and by a CHECK constraint. |
| Tends per animal per day | 1 | The UPDATE's own `cared_on` guard in `careStackAcresUnit`, not the service's check. The service check exists to give the second tap a sentence; the where clause is what makes it true under a race. |
| Ray's feed gifts | `CARE_GIFT_TOTAL_SERVINGS` = 30, ever | Each rung is claimed by an atomic `+1` on `homestead_secret_ledger` whose returned quantity is 1 exactly once. The ladder is closed, so that total is the whole exposure. |
| Livestock slots | base 3 + 3 purchased + 2 Barn | `homestead_units_enforce_stock_shape`, advisory-locked. The service's `capacityFor` mirrors it for the friendly refusal. |

## Offline

Derived, never simulated — the same posture `lib/stackacres/units.ts` takes for everything else. A
streak is two stored fields (`cared_on`, `care_streak`) plus a comparison against today. A player
away for a week is answered by arithmetic at the moment they tend again. No background job, nothing
to replay, and nothing that could be rerolled by pulling to refresh.

## Comfort threading

`hungryAtFor` and everything downstream of it (`effectiveStackAcresCycle`,
`isStackAcresUnitHungry`, `isStackAcresUnitReady`, `toStackAcresUnitSnapshots`, `feedPushFor`,
`planSiloFeeding`) take a `comfort` multiplier defaulting to `1`. Callers that have not read the
farm's machines keep asking exactly the question they always asked. The ones that matter —
`view`, `snapshots`, both feed paths, the collect path and the Feed Silo — pass the real value, so
a Barn farm never sees one screen call an animal hungry and another call it fed.

## Files

- Rules: `lib/stackacres/barn.ts` (+ `barn.test.ts`)
- Clock threading: `lib/stackacres/units.ts`, `lib/stackacres/feed-silo.ts`
- Machine: `lib/stackacres/machines.ts`, `lib/stackacres/build-cost.ts`
- Server: `lib/server/stackacres-service.ts` (`careForStackAcresAnimal`),
  `lib/server/stackacres-store.ts` (`careStackAcresUnit`) (+ `stackacres-barn-service.test.ts`)
- Route: `app/api/stackacres/actions/route.ts` (`care`)
- Client: `components/arcade/stackacres/stackacres-barn-panel.tsx`, the HUD badge in
  `stackacres-farm.tsx`, `lib/stackacres/optimistic-actions.ts`
- Story: `lib/stackacres/story/events.ts`, `quests.ts`, `predict.ts`
- Migration: `supabase/migrations/20261001020000_stackacres_barn_routine.sql`
- E2E: `tests/e2e/stackacres-barn.spec.ts`
