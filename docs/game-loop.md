# The game loop: client-ignited, server-validated

This document explains how a StackChips table moves forward. No player
presses anything to make this happen. The design is unusual on purpose.
Other engineers proposed the obvious alternatives already. The team rejected
each alternative for reasons the code alone does not show. This document
records those reasons.

## The one-sentence version

A seated browser sends one signal: a prompt that something may be due. The
server alone decides if a step is due. The server performs the step. The
server writes the result under optimistic concurrency.

The browser supplies:
- no timestamp
- no action
- no authority

The browser supplies only the prompt.

## What the client actually does

`lib/game/turn-clock.ts` is a pure function. The function reads a game
snapshot. The function answers one question: when should this browser send
`POST /api/games/[id]/advance`? The answer may be never.

The browser can wait on two deadlines. The browser never waits on both
deadlines at the same time.

| deadline | set when | cleared when |
|---|---|---|
| `turnDeadlineAt` | a seat starts its turn | the hand ends |
| `nextHandAt` | a hand ends with at least two funded seats | the game deals the next hand |

`planTurnClock` first checks for a live turn deadline. `planTurnClock` uses
`nextHandAt` as a backup. With neither deadline set, `planTurnClock` returns
`idle`. An idle browser sends no request. This idle state is correct for a
table with no funded opponents. This idle state is also correct for a table
still waiting for players.

Every seated human's browser stands ready to send the request, but the
browsers queue, in order. The browser with the live deadline sends its
request first, at the deadline. Each other browser waits an extra
`BACKUP_STAGGER_MS` per place in the queue. A successful advance changes the
`version` value. The broadcast then wakes every browser. Each waiting backup
browser re-plans its own wait, then cancels itself.

The ordinary case needs exactly one request. If a player closes their tab,
the next browser in the queue covers the gap. The table never stalls.

This design replaced two failure modes. Both failure modes appeared live.
The header comment of `turn-clock.ts` records both:

- An unconditional 1.5-second poll sent 18 requests in 30 idle seconds.
- A single elected browser controlled each table. If that browser
  disappeared, the table froze completely.

## What the server actually does

`POST /advance` is not a command. `POST /advance` is a request to evaluate
the game state.

1. **Authenticate.** The server checks for a `river_session` cookie.
   - No cookie: the server returns 401.
   - A cookie, but no seat at this table: the server returns 403.

   A background `fetch` from the server itself carries neither the cookie
   nor a seat. This is why self-calling designs do not work here. See
   "Rejected alternatives" below.

2. **Decide, from the server's own clock.** `resolveTimedAdvance` calls
   `dealNextHandIfDue(state)` and `advanceTimedTurn(state)`. Neither call
   passes a `now` argument. Both functions default to the server's own
   `Date.now()` value. **No client-supplied time ever reaches the engine.**
   A browser that sends its request one second early gets back only its
   current snapshot. A dishonest browser has no time value to falsify.

3. **Write optimistically.** `try_persist_timed_game_action` takes the
   version number the caller started from. If another request already won,
   `try_persist_timed_game_action` returns `false` instead of raising an
   error. The losing browser then re-reads the winner's state, rather than
   replaying its own decision on top of it. This behavior keeps the backup
   queue safe: several browsers can wake together and still produce only
   one deal, not four.

The server catches up in one pass instead of stepping through turns one at
a time. One request can resolve a whole run of overdue turns, up to
`MAX_ADVANCE_STEPS` (currently 12). This design makes a backgrounded tab, or
a dropped connection, recoverable without polling. A table can fall behind
by many turns, not only one turn. The next request settles every overdue
turn at once.

## `nextHandAt` specifically

`scheduleNextHand()` schedules a finished hand. Two places call
`scheduleNextHand()`: `awardUncontested` and `showdown`. Both places mark
the actual end of a hand.

A third place also sets `status` to `"complete"`: `setupHand`'s bail-out
path, used when fewer than two seats hold chips. `scheduleNextHand()`
deliberately skips this third place. A table that cannot deal must not
advertise a deadline. Otherwise every seated browser would wake at that
deadline, ask to advance, and get the same unusable answer forever.

One delay always applies: `NEXT_HAND_DELAY_MS`, 2.8 seconds. The team
derived this value from the celebration animation, rather than choosing it
arbitrarily. The longest animation on a finished table is `win-amount-rise`:
1.4 seconds, starting at a .78-second offset. This animation finishes at
2.18 seconds. `NEXT_HAND_DELAY_MS` leaves one extra beat after the
animation ends.

`app/styles/stylesheets.test.ts` reads the stylesheet files. This test
fails if any celebration animation grows past the `NEXT_HAND_DELAY_MS`
constant, because no other tool in the toolchain reads both a TypeScript
value and a CSS keyframe together.

`NEXT_HAND_DELAY_MS` was once 4 seconds, from when a player still pressed a
button to move on. The deal became automatic, and that extra second then
became dead air instead of a chance to act.

A second, longer delay used to exist: `BUSTED_REBUY_GRACE_MS`, 20 seconds.
This delay held whenever a seated human had just lost their last chip. This
delay kept the rebuy dialog open in front of that player, before the table
handed that player's seat to a bot.

The team removed `BUSTED_REBUY_GRACE_MS`. One player busting had forced
every other seated browser to wait 20 seconds instead of 2.8 seconds, and a
real table never holds up other players for one person's decision.

A busted human now keeps their own seat. `setupHand`'s own per-seat pass
reads the zero stack and sits that player out, the same as any other
unfunded seat. The table deals the next hand at the normal 2.8-second beat.
This beat stays the same, regardless of who busted or how many players
busted.

See `releaseBustedSeats` and its callers in `lib/game/engine.ts`, and see
`lib/game/busted-seat.test.ts`.

`setupHand` clears `nextHandAt` before its funded-seats check. The
dead-table branch therefore cannot inherit the deadline that woke it.

`normalizeGameState` reads a missing `nextHandAt` value as `null`. Tables
saved before continuous play therefore keep their original behavior: these
older tables still wait for a player to press Deal.

### Where the deal happens, and why not where expected

`dealNextHandIfDue` is a separate function from `advanceTimedTurn`. This
separation is load-bearing, not incidental. `advanceTimedTurn`'s contract
states: an action and an actor, or nothing happened. Its caller in
`game-store.ts` returns early on a null action, and persists nothing.

The first implementation dealt the hand inside `advanceTimedTurn` itself.
This design dealt the hand only in memory, and the dealt hand was never
saved. The browser advanced, saw no change, and re-dealt a hand nobody ever
saved, forever. Splitting `dealNextHandIfDue` out makes the persistence
step explicit.

The engine persists the deal through the same optimistic RPC as every other
deadline. This write uses `action_type = next_hand` and a null
`actor_seat_id`. No schema change was needed for this: `game_actions.actor_seat_id`
has always allowed a null value, and `next_hand` has always
been part of the `action_type` enum, because the old human "Deal next hand"
button already wrote this exact same row.

## Rejected alternatives

**Vercel Cron.** Vercel Cron offers only minute granularity. This game
needs a four-second transition. Vercel Cron also has the wrong shape: a
cron job sweeps every table, whether or not anything is due.

**`waitUntil` plus a background self-`fetch`.** An engineer proposed this
design in detail. Three separate reasons block this design here. Any single
reason alone is fatal.

- `/advance` cannot start a hand at all. `advanceTimedTurn` returns
  immediately unless `status` equals `"playing"`. Dealing happens through
  the separate `next-hand` action on the `/actions` route.
- Both routes need a `river_session` cookie and a seat at the table. A
  server-side `fetch` carries neither. The server rejects this call before
  the first reason even matters.
- A `setTimeout` inside `waitUntil` holds a billed serverless isolate idle
  for the whole delay, per completed hand, per table. This design still
  delivers no sub-second responsiveness, because it explicitly waits.

**A manual "Deal next hand" button.** The table used to have this button.
The team removed the button instead of keeping it alongside the timer: two
ways to start a hand create a problem. The button is usually a no-op by the
time a player presses it, and it adds clutter to the one control strip that
must stay legible.

No control now forces a deal by hand. The busted player's old "Close seat"
control is also gone; this control was the same action in a different
form. A busted seat now offers Rebuy at any time, not only between hands.
The header's persistent "Leave table" control remains the only exit.

This design has one cost. A table that cannot deal again has no button to
offer. `ActionBar` reads `nextHandAt` instead, and offers "Return to lobby"
rather than an empty control row.

One real exception exists to "any time." A seat that lost its last chips
going all-in keeps status `all-in`, not `out`, until that hand finishes
deciding the seat's fate. `isSeatRebuyEligible` (`lib/game/rebuy.ts`) is the
one shared predicate for this rule; the engine, the `/actions` route, and
`ActionBar` all use it. The Rebuy button therefore does not appear until
the server would actually accept it.

An earlier version disagreed with the server on this point. The button
showed whenever `stack === 0` alone. The server then returned a 409 error
until the hand resolved, and nothing retried the request automatically.
The fix made this document's "no window to miss" claim true, not merely a
goal.

**A persistent Node worker.** Code for a persistent Node worker used to
exist under `lib/server/table-manager/`, together with a matching
`cash_game_sessions` ledger in `lib/server/cash-game-session-store.ts`.
Neither was ever reachable in production: the entry point had no caller,
and `assertPersistentTableRuntime()` threw an error whenever
`process.env.VERCEL` was set, so no part of this code could run live.

The team deleted this code as dead weight. Recover it with
`git checkout c372499 -- lib/server/table-manager lib/server/cash-game-session-store.ts`,
if a worker is ever built for real. The `cash_game_sessions` table and its
RPCs still remain in the database, because migrations here are
append-only.

Keeping the loop in the browsers lets guest play stay first-class. A seated
guest already holds the session cookie the route needs, with:
- no account
- no JWT
- no extra infrastructure

## Invariants worth not breaking

- The engine never reads a client-supplied clock.
- Exactly one of `turnDeadlineAt` or `nextHandAt` holds a non-null value at
  a time.
- A table that cannot deal has neither deadline set, so it generates no
  traffic.
- Every state change under a deadline goes through the optimistic RPC.
  Otherwise several browsers repeat the same change several times.

## Where to look

| concern | file |
|---|---|
| when a browser sends its request | `lib/game/turn-clock.ts` |
| what is due, and the response to it | `lib/game/engine.ts` (`advanceTimedTurn`, `dealNextHandIfDue`, `scheduleNextHand`) |
| catching up and persisting | `lib/server/game-store.ts` (`resolveTimedAdvance`) |
| authentication and the HTTP surface | `app/api/games/[id]/advance/route.ts` |
| the broadcast that cancels the backups | `lib/game/table-channel.ts` |
| tests | `lib/game/continuous-table.test.ts`, `lib/game/turn-clock.test.ts`, `tests/e2e/continuous-table.spec.ts` |
