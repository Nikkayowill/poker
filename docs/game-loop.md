# The game loop: client-ignited, server-validated

How a StackChips table moves forward when nobody has pressed anything. Written
down because the shape is unusual on purpose, and because the obvious
alternatives have each been proposed and rejected for reasons that are not
obvious from the code alone.

## The one-sentence version

Seated browsers say *"I think something is due"*; the server decides whether
anything actually is, does it, and writes it under optimistic concurrency. The
browser supplies no timestamp, no action and no authority — only the prompt.

## What the client actually does

`lib/game/turn-clock.ts` is a pure function. Given a snapshot it answers one
question: when, if ever, should this browser `POST /api/games/[id]/advance`?

There are two deadlines it can be waiting on, and never both at once:

| deadline | set when | cleared when |
|---|---|---|
| `turnDeadlineAt` | a seat is put on turn | the hand completes |
| `nextHandAt` | a hand completes with ≥2 funded seats | the next hand is dealt |

`planTurnClock` prefers a live turn deadline and falls back to `nextHandAt`.
With neither, it returns `idle` and the browser generates nothing at all —
which is the correct resting state for a table with no funded opponents or one
still waiting for players.

Every seated human is willing to fire, but they queue. The browser whose clock
it is goes at the deadline; each other browser waits `BACKUP_STAGGER_MS` per
place in line. A successful advance changes `version`, the broadcast wakes
everyone, and every pending backup re-plans and cancels itself. So the ordinary
case is exactly one request, and the case where that player closed their tab is
covered by the next in line rather than stalling.

This replaced two failure modes, both observed live and both recorded in the
header comment of `turn-clock.ts`: an unconditional 1.5s poll (18 requests in
30 idle seconds), and a single elected browser whose disappearance froze the
table completely.

## What the server actually does

`POST /advance` is not a command. It is a request to *evaluate*.

1. **Authenticate.** No `river_session` cookie → 401. Not seated at this table
   → 403. A background `fetch` from the server itself has neither, which is why
   self-calling designs do not work here (see below).
2. **Decide, from the server's own clock.** `resolveTimedAdvance` calls
   `dealNextHandIfDue(state)` and `advanceTimedTurn(state)` with no `now`
   argument, so both default to the server's `Date.now()`. **No client-supplied
   time reaches the engine.** A browser that fires a second early gets a
   snapshot back and nothing else; a browser that lies about the time has
   nothing to lie with.
3. **Write optimistically.** `try_persist_timed_game_action` takes the version
   the caller started from and returns `false` rather than raising when another
   request got there first. The loser re-reads the winner's state instead of
   replaying its own decision on top. This is what makes the backup queue safe:
   several browsers waking together produce one deal, not four.

Because the server catches up rather than steps, one request resolves a *run*
of overdue turns (`MAX_ADVANCE_STEPS`, currently 12). That is what makes a
backgrounded tab or a dropped connection recoverable without polling — the
table is not behind by one turn, it is behind by however many, and the next
request settles all of them.

## `nextHandAt` specifically

A finished hand is scheduled by `scheduleNextHand()`, called at the two places
a hand actually ends — `awardUncontested` and `showdown`. Deliberately *not* at
the third place `status` becomes `"complete"`: `setupHand`'s bail-out when
fewer than two seats have chips. A table that cannot deal must not advertise a
deadline, or every seated browser would wake at it, ask to advance, and be told
the same thing forever.

Two delays:

- `NEXT_HAND_DELAY_MS` (2.8s) — derived from the celebration rather than
  chosen. The longest animation on a finished table is `win-amount-rise`, 1.4s
  from a .78s offset, so everything is over at 2.18s and this leaves a beat
  after it. `app/styles/stylesheets.test.ts` reads the stylesheets and fails if
  any celebration animation grows past the constant, because nothing else in
  the toolchain reads both a TypeScript value and a CSS keyframe. It was 4s
  while a player still pressed a button to move on; once the deal became
  automatic that extra second was dead air rather than a chance to act.
- `BUSTED_REBUY_GRACE_MS` (20s) — when a seated *human* has just lost their
  last chip. Dealing on the normal beat runs `releaseBustedHumanSeats` and
  hands their seat to a bot with the rebuy dialog still open in front of them.
  A busted *bot* does not extend anything; nobody is reading a dialog.

`setupHand` clears `nextHandAt` before its funded-seats check, so the dead-table
branch cannot inherit the deadline that woke it.

`normalizeGameState` reads a missing `nextHandAt` as `null`. Tables persisted
before continuous play therefore behave exactly as they did when those rows
were written: they wait for someone to press Deal.

### Where the deal is performed, and why not where you would expect

`dealNextHandIfDue` is a separate function from `advanceTimedTurn`, and this is
load-bearing. `advanceTimedTurn`'s contract is *"an action and an actor, or
nothing happened"*, and its caller in `game-store.ts` returns early on a null
action **without persisting anything**. The first implementation dealt the hand
inside it, which meant the hand was dealt in memory and dropped on the floor —
the browser advanced, saw no change, and re-dealt a hand nobody ever saved,
forever. Splitting it out is what makes the persistence explicit.

The deal is persisted through the same optimistic RPC as every other deadline,
with `action_type = next_hand` and a **null** `actor_seat_id`. No schema change
was needed: `game_actions.actor_seat_id` has always been nullable and
`next_hand` has always been in the `action_type` enum, because the human "Deal
next hand" button writes exactly that row.

## Rejected alternatives

**Vercel Cron.** Minute granularity against a game that needs a four-second
transition. Also wrong shape: a cron job sweeps *all* tables whether or not
anything is due.

**`waitUntil` + a background self-`fetch`.** Proposed in detail; does not work
here for three separate reasons, any one of which is fatal.

- `/advance` cannot start a hand at all. `advanceTimedTurn` returns immediately
  unless `status === "playing"`. Dealing happens through `next-hand` on
  `/actions`, a different route.
- Both routes require a `river_session` cookie and a seat at the table. A
  server-side `fetch` carries neither, so the call is rejected before any of
  the above matters.
- A `setTimeout` inside `waitUntil` holds a billed serverless isolate idle for
  the whole delay, per completed hand, per table — and still does not deliver
  sub-second responsiveness, because it is explicitly waiting.

**A manual "Deal next hand" button.** This is what the table used to have, and
it was removed rather than kept alongside the timer: two ways to start a hand
means a button that is usually a no-op by the time it is pressed, and clutter
in the one strip that has to stay legible. The one place it survives is the
busted player's "Close seat", which is a different decision wearing the same
action. The cost is that a table which *cannot* deal again has no button to
offer, so ActionBar reads `nextHandAt` and offers "Return to lobby" instead of
an empty control row.

**A persistent Node worker.** The code for one exists in
`lib/server/table-manager/`, and `assertPersistentTableRuntime()` throws
whenever `process.env.VERCEL` is set, so none of it runs in production today.
Keeping the loop in the browsers is what lets guest play stay first-class: a
seated guest already holds the session cookie the route requires, with no
account, no JWT and no extra infrastructure.

## Invariants worth not breaking

- The engine never reads a client-supplied clock.
- Exactly one of `turnDeadlineAt` / `nextHandAt` is non-null at a time.
- A table that cannot deal has neither, so it generates no traffic.
- Anything that changes state under a deadline goes through the optimistic RPC,
  or several browsers will do it several times.

## Where to look

| concern | file |
|---|---|
| when a browser fires | `lib/game/turn-clock.ts` |
| what is due, and what to do about it | `lib/game/engine.ts` (`advanceTimedTurn`, `dealNextHandIfDue`, `scheduleNextHand`) |
| catching up and persisting | `lib/server/game-store.ts` (`resolveTimedAdvance`) |
| authentication and the HTTP surface | `app/api/games/[id]/advance/route.ts` |
| the broadcast that cancels the backups | `lib/game/table-channel.ts` |
| tests | `lib/game/continuous-table.test.ts`, `lib/game/turn-clock.test.ts`, `tests/e2e/continuous-table.spec.ts` |
