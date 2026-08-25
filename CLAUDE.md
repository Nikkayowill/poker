# StackChips — Claude Context

## Project

StackChips (`stackchips.app`) is a Next.js 16/React 19/strict TypeScript six-max Hold'em app. The server is authoritative. Supabase supplies persistence, Realtime, Auth linkage, and Storage; absent env vars, stores use memory.

## System map

`components -> app/api -> lib/game -> lib/server -> memory | Supabase`

Realtime carries only versioned invalidations; `components/poker-app.tsx` refetches the filtered snapshot. Browser requests contain intents only.

## Read first

- App/client: `app/layout.tsx`, `app/page.tsx`, `components/poker-app.tsx`
- Lobby/table: `components/lobby/lobby.tsx`, `components/table/poker-table.tsx`
- Game routes: `app/api/games/`, especially `[id]/actions/route.ts` and `[id]/advance/route.ts`
- Rules: `lib/game/engine.ts`, `lib/game/types.ts`, `lib/game/evaluator.ts`
- Data: `lib/server/game-store.ts`, `lib/server/profile-store.ts`, `lib/server/supabase-admin.ts`
- Auth: `middleware.ts`, `lib/server/session.ts`, `lib/auth/client.ts`
- Realtime: `lib/game/table-channel.ts`
- DB/env: `supabase/migrations/`, `supabase/config.toml`, `.env.example`
- Product constraints: `docs/game-loop.md`, `docs/launch-checklist.md`, `docs/security-audit.md`

Subsystem-specific gotchas moved out of this always-loaded file into where they load on demand:
`components/game3d/CLAUDE.md` (3D room), `lib/scene/CLAUDE.md` (2D table), `lib/scene/chips/CLAUDE.md`
(chip system), `app/styles/CLAUDE.md` (styling contract), and the `deploy-checklist` skill (pre-merge/deploy).

## Rules

- Mutate through server routes + engine; never accept client-owned game truth.
- Keep game reads write-free and mutations version-checked/atomic.
- Never leak service-role secrets or private aggregate state; preserve RLS.
- Append migrations; preserve numbered CSS order.
- `river_*` cookies/module names and Sentry slugs are legacy compatibility IDs; do not casually rename them.
- Test changed rules/layout. Run: `npm test`, `npm run lint`, `npm run build`; use `npm run test:e2e` for flows/UI.
- Preserve unrelated work; `.claude/` may be locally untracked.

## Active milestone

- Track: `ui-redesign-foundation`. Current feature branch: `feat/pvp-duels-ui-sounds-3d-avatars`.
- Full narrative history of each pass (what was tried, reverted, measured) has been pruned from this
  file to stay under the memory budget — recover it from `git log` on the commits/PRs named below if
  the reasoning behind a decision is needed. What's kept here is what would otherwise be silently
  relearned or silently broken.

### Leaderboards are PvP-only: Memory Match's board is gone (2026-08-24)
- The rule, settled with Kayo while Minesweeper was being built and restated three times: **every PvP
  game gets a leaderboard, poker keeps its own richer one (hands won, biggest pot, not just W/L), and
  Ante Up SOLO games get none.** It came up because a first pass gave solo Minesweeper a board and
  then had to pick which of three difficulties to rank on. Kayo rejected per-difficulty boards as
  "too much" — the cost is screen, not compute (`game_leaderboard_stats` is one small row per player
  per game, but the tab row is already nine wide on a phone, and ten solo games x3 difficulties would
  be thirty tabs). So a new solo Ante Up game adds no `LEADERBOARD_GAMES` entry and makes no
  leaderboard write; `lib/leaderboard/contract.ts`'s header now states this and a test names the solo
  ids one by one so a future entry can't slip in.
- Memory Match predated the rule and was the only game contradicting it. Branch
  `chore/drop-solo-memory-leaderboard` off origin/main.
- **This needed a migration, which is exactly why it wasn't a one-line deletion.**
  `global_leaderboard_entries()` names `'memory-match'` in its own SQL as its only lower-is-better
  pool, so dropping the registry entry alone would have taken away the tab and the writes while the
  Global blend kept folding a hidden board's percentiles into everyone's global score — a board
  nobody can open and nobody can be shown their standing on.
- Existing `game_leaderboard_stats` rows for the game are **left in place, not deleted**. Nothing
  reads that table except by an id the registry knows, so they are inert, and they are the only
  record of those clears. Same call as the retired casino games' orphaned `arcade_rounds` rows.
- Second commit, separable on purpose: with that game gone the whole **average-metric ranking path
  had no member and no caller**, so `recordMetricResult`, the `average_metric` kind, the
  `lower_better` direction, the metric branches in qualifying/scoring/sorting, and
  `metricSum`/`metricCount` on `LeaderboardStats` are all deleted. The `metric_sum`/`metric_count`
  COLUMNS stay (migrations are append-only) and `apply_leaderboard_result` already defaults both
  params, so the writes simply stop passing them.
- The SQL's `higher_better` flag and its mirror in the memory branch **stay**, even though every
  surviving row sets it true — that is the pool's generic scoring rule in three words, not a branch
  belonging to the deleted game, and the next game that ranks low-to-high sets it and needs nothing
  else. The line between that and the deleted TS machinery is member-count vs. subsystem-weight.
- `isHeadToHeadGame` is now registry membership rather than `kind === "win_loss_record"`: every game
  that gets a board is played against a named opponent, so the two questions have the same members.
  Poker is the one game that answers no while still having a board — it was never in this registry,
  ranking off `player_stats` instead.
- Verified: `npx vitest run` 2371/2371 green, clean lint, clean production build, `tsc` clean apart
  from the pre-existing `safe-area.spec.ts` failure. The migration is **unapplied** — see
  `[[reference_stackchips_migrations_not_auto_applied]]`; merging the PR ships code only, and until
  it is applied the Global blend keeps scoring a board the app no longer shows.

### Web Push re-engagement notifications (2026-08-24)
- Kayo: "I need to notify users to come back somehow now that I have a solid PWA," with PlayPokerGO's
  own push copy as the reference ("Case of the Mondays?... tap to play now"). Scoped down via two
  direct answers: v1 trigger is only "come claim your daily Gold" (not turn-based/social pushes yet),
  and permission is asked **as part of creating an account**, not a later soft prompt or a
  settings-only toggle. On `feat/push-notifications` (worktree `.claude/worktrees/push-notifications`),
  committed, not pushed/PR'd. There was zero push infrastructure anywhere in the app before this pass
  — no VAPID keys, no subscription table, no `push`/`notificationclick` handlers in `public/sw.js`.
- New `push_subscriptions` table (service-role only, same shape as `ante_up_attempts` — RLS enabled,
  `revoke all from anon, authenticated`), `lib/server/push-subscription-store.ts` (twin memory/Supabase
  branch), `lib/server/push-service.ts` wrapping the `web-push` package. Off by default: unset VAPID
  env vars mean `requestPushPermissionAndSubscribe` never prompts and the cron sender no-ops, same
  "empty key, feature quietly off" pattern as `TURNSTILE_SITE_KEY`.
- Permission is requested inside `submitEmailForm`'s "Create account" branch and the "Continue with
  Google" button's `onClick` (`components/auth/account-entry-card.tsx`) — both are real user gestures,
  which is what lets `Notification.requestPermission()` show its dialog at all. Google's button is
  asked every time (sign-in and sign-up both, since OAuth gives no way to tell which before the
  redirect) — safe, because a browser that has already decided answers instantly with no dialog on
  every later call, so a returning Google player is never re-prompted, just silently re-checked.
- **The daily cron (`/api/cron/notify-inactive-players`, `0 22 * * *` in `vercel.json`) is a single
  fixed UTC time with no per-player timezone** — this app has never stored one (registration is
  email/Google, not a profile field). 22:00 UTC lands in the US afternoon/evening, which is a
  compromise, not a fix; a real fix needs timezone capture at sign-up, flagged as a gap, not built
  here. The query itself (`pushSubscriptionsForInactivePlayers`) joins subscriptions to
  `profiles.last_daily_claim_at`, matching `isSameUtcDay`'s existing UTC-midnight boundary — a
  `last_notified_at` column on each subscription is belt-and-suspenders against a Vercel cron retry
  double-sending the same day.
- `lib/push/copy.ts` holds a rotating pool of PlayPokerGO-style lines (`pickComeBackPushCopy`, seeded
  off profile id + day so a re-run doesn't reshuffle who gets which line) rather than one fixed
  string — Kayo's own reference example was specifically about that playful, varied register, not a
  generic "You have a notification."
- Player menu gained a "Notifications" toggle (`components/poker-app.tsx`), registered-profiles only.
  It tracks TWO separate things, not one: `Notification.permission` (a browser can never let JS revoke
  this once granted — only the OS/browser settings can) and whether this device currently holds a live
  `PushSubscription` (what `disablePushOnThisDevice` actually unsubscribes) — collapsing them into one
  boolean would have the toggle claim "On" forever after a player turns it off.
- Wiring the permission-refresh effect around `react-hooks/set-state-in-effect` needed the same
  `window.setTimeout(..., 0)` deferral `loadProfile`'s own effect already uses a few hundred lines up
  — the linter still flags a `setState` reachable from an async function awaited directly inside an
  effect, awaiting first is not enough on its own; wrapping the call in a deferred macrotask is what
  the codebase already does and what actually satisfies it.
- Real VAPID key pair generated this pass and handed to Kayo directly (not committed) — needs adding
  as `NEXT_PUBLIC_VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` in Vercel env and `.env.local`
  before anything here does anything. `supabase/migrations/20260824130000_push_subscriptions.sql` is
  unapplied to production, per `[[reference_stackchips_migrations_not_auto_applied]]` — merging the PR
  ships code only.
- Privacy Policy bumped to version 3 for the new push-subscription data category (one new paragraph,
  `lib/legal/documents.ts`) — this only re-triggers consent for players who open the store, per how
  `pendingAcceptances` is actually gated; it does not touch the sign-up flow itself.
- A real bug caught by the store's own tests before this ever shipped: the memory-mode branch of
  `savePushSubscription` called `randomUUID()` twice per upsert (once for the Map key, once for the
  row's own `id` field) — a resubscribe on the same device landed under a fresh map key while the old
  row stayed put under its original one, so every re-subscribe silently duplicated the row instead of
  updating it. Fixed by generating the id once and reusing it for both.
- Not done this pass: turn/social triggers (someone's turn, a friend challenge) were explicitly cut to
  v1 scope by Kayo's own answer — `lib/push/copy.ts`'s doc comment notes the pool is reusable for a
  second trigger later. No per-player timezone (see the cron note above). No route-level tests for
  `/api/push/subscribe`/`/unsubscribe` — coverage lives at the store/service level, matching this
  repo's existing convention (4 of 74 API routes have dedicated route tests; the rest lean on their
  service layer, and this follows suit).
- Verified: full `npx vitest run` (2370/2370, up from 2356) green, `npx tsc --noEmit` clean apart from
  the pre-existing `safe-area.spec.ts` failure, clean `npm run lint`, clean production `npm run build`
  with `/api/push/subscribe`, `/api/push/unsubscribe`, and `/api/cron/notify-inactive-players` all
  present. Grepped `.next/static` for the VAPID private key string, same reasoning as Word Race's
  answer-bank leak (2026-08-12) — clean, nothing server-only reached the client bundle.

### Seat-art roster grown to 35; character22-31 caught facing the wrong way (2026-08-22)
- Four more Kayo-supplied turnaround sheets (`character32`-`35`), same
  `slice-seat-sheet.py` pipeline, all `--mirror`ed (they turn screen-right
  like every generated sheet has so far). `character33`'s sheet had two
  panels touching with no gutter — the automatic column splitter refused it,
  so that one pair was split by hand at the column-count minimum and keyed
  with the script's own flood-fill, not a full re-render. Priced onto the
  existing rare-tier ladder (1,550,000-2,060,000, continuing its ~9-12% step
  rather than opening a new block); named as plain character names, not
  gamer tags — Kayo's mid-task clarification: the underscored register
  (`jaxdidthat`, `zay_brooks`, ...) is for the in-game bot pool only, so a
  seated opponent reads as a real player's handle, and is a *separate* axis
  from a store card's name, which is a normal name for the character on it.
- **`character22`-`31` (yesterday's ten-character batch) were actually
  facing screen-RIGHT, not screen-left as that pass's commit and catalog
  comment both claimed.** Caught while eyeball-checking today's four new
  sheets against the established convention: `character16`/`17` (long
  verified) face screen-left at 40deg the way `lib/scene/seat-art.ts`'s
  un-mirrored-plate contract requires; `character22` through `character31`
  all faced screen-right instead — the exact mistake `character13`-`21`
  needed fixing for on 2026-08-21, recurring because the "already turned
  screen-left, none needed --mirror" call was eyeballed wrong a second time,
  not because the pipeline changed. Fixed by flipping the nine already-cut
  `art/seats/character22-31/*.png` plates in place (no re-slicing) and
  rebuilding through `prepare-seat-art.py`. **There is still no automated
  facing check** (see `slice-seat-sheet.py`'s own note on why one heuristic
  tried and rejected false-positived on three good characters) — verify a
  new batch's widest panel against `character16`/`17` specifically before
  trusting a "no mirror needed" call, don't just eyeball the sheet in
  isolation.
- Verified: `npx vitest run` 2328/2328 green (catalog's ladder test extended
  to cover `character32`-`35`), clean lint, clean production build with
  every route present.

### Ante Up split back in two: Sudoku/Memory unlimited, Word Stack/Connections keep the daily gate (2026-08-21)
- Same-day follow-up to the section directly below this one. Kayo's report after that shipped: "still
  not how I want it... choose a wager before the game even starts... no more daily limits EXCEPT for
  daily word stack and connections." Nothing about that day's merge was wrong on its own terms -- it
  just solved a different problem than the one being asked now, on branch
  `feat/wager-before-game-start` off origin/main (a separate worktree; the branch this was built on had
  no idea the section below existed until `git log` turned it up mid-conversation -- see
  `[[reference_stackchips_concurrent_sessions]]`, this is exactly the trap that memory exists for).
- **Sudoku and Memory Match lost their daily gate entirely.** `/games/sudoku` and `/games/memory` now
  render what `/games/ante-up-sudoku` and `/games/ante-up-memory` already rendered (lib/arcade/ante-up.ts,
  ante-up-memory.ts, and their services/components) directly -- wager-or-Free chosen up front, replayable
  any time, no bonus, no cap. The old free-only daily boards (`lib/server/sudoku-service.ts`,
  `memory-service.ts`, their routes, `sudoku-board.tsx`/`memory-board.tsx`) are deleted, not retired.
  `/games/ante-up-sudoku` and `/games/ante-up-memory` are now thin redirects to the primary routes, kept
  only for stale links. Memory's turn-count leaderboard hook (`recordMetricResult`, previously only on
  the deleted daily path) moved into `ante-up-memory-service.ts`'s win handler so it keeps feeding on
  every clear, wagered or free, rather than going silent.
- **Word Stack and Connections keep their once-a-day shared puzzle -- that was never in question.** What
  changed is where the wager sits: instead of a free daily play followed by a link to a second,
  separately-repeatable "Ante Up" sibling on a fresh (non-shared) board, the wager-or-Free step now
  gates *opening that one daily attempt*. The repeatable siblings (`ante-up-word-stack-service.ts`,
  `ante-up-connections-service.ts`, their routes, `ante-up-word-stack.tsx`/`ante-up-connections.tsx`
  components) are deleted outright -- Kayo's explicit call was that these two stay capped at one
  attempt a day no matter how it's played, which is structurally incompatible with a second unlimited
  mode existing at all. Their payout-scoring math survives, trimmed down to pure functions
  (`anteUpWordStackPayout`, `anteUpConnectionsPayout`, the `*DailyBonusMultiplier` pair) in
  `lib/arcade/ante-up-word-stack.ts`/`ante-up-connections.ts`, now called directly by
  `word-stack-service.ts`/`connections-service.ts` against the SAME stored round instead of a second one.
  The stored round gained a `wager: number` field embedded in its own JSON state (`StoredWordStackRound`/
  `StoredConnectionsRound`) rather than a new migration column -- `daily-puzzle-store.ts` is generic over
  the round shape by design, so this needed no schema change.
- **A wager replaces the free path's daily completion bonus, it does not stack with it** -- confirmed
  with Kayo rather than assumed, since this app has a history of every faucet-sizing decision like this
  one being an explicit call, not a default. Free (wager 0) play is byte-for-byte the same behavior as
  before: `creditDailyBonus` on completion, win or lose. A wagered attempt earns the wager's own
  win-only payout instead, following the same three money-ordering rules every other staked game in
  this file restates: debit before the row exists (refund on a failed insert), credit only after the
  version-guarded settle write is confirmed, one credit, never a second debit.
- `lib/server/daily-puzzle-bonus.ts`'s `claimSudokuDailyBonus` (the once-per-day-total idempotency gate
  across Sudoku's four difficulties) is deleted along with the daily mode it existed for; the flat
  retired "Complete one brain game" mission stays disabled exactly as the section below left it.
- Catalog (`lib/arcade/games.ts`): all four rows stay `kind: "wager"` -- the mechanic didn't change,
  only where the daily line sits. `daily-sudoku`'s display name is now plain "Sudoku"; its id string is
  untouched (internal, not user-facing, and renaming it would ripple into every place that keys off it
  for no reader-facing benefit). `arcadeEntryLabel` now reads two different sentences for the same
  `kind: "wager"` zero-cost row, keyed off which sub-shape a game is in ("Free daily · or wager it" for
  Word Stack/Connections, "Free, or wager Gold" for Sudoku/Memory Match) -- collapsing them into one
  sentence was exactly what the section below got right (bare "Free to play" reading as "nothing is
  wagered here") and exactly what would go wrong again if a shared sentence tried to describe two now-
  different mechanics.
- Blackjack gained a "Practice hand (Free)" toggle the same pass, kept deliberately separate from the
  shared `STAKES_TIERS` ladder (also used by the real-money poker lobby buy-in flow) -- see
  `lib/server/blackjack-service.ts` and the new migration loosening `blackjack_rounds.base_stake`'s
  check to `>= 0`.
- Verified: full `npx vitest run` (2330/2330) green, `npx tsc --noEmit` clean (only the pre-existing,
  already-documented `safe-area.spec.ts` failure), clean `npm run lint`, clean production `npm run
  build` with every route present. Not yet applied: the Blackjack migration (`apply_migration` is a
  deploy-time step, not part of this pass) -- see `[[reference_stackchips_migrations_not_auto_applied]]`.

### Ante Up unified: one section, four brain games, daily bonus + repeatable wager (2026-08-21)
- Kayo's report: "I still see free to play section in the ante up tab... it still only shows ante
  up for sudoku." Nothing was reverted — PR #88 (2026-08-16) built the solo-wager mechanic but
  scoped it to Sudoku only, and never got extended. On branch `feat/ante-up-unify-brain-games`
  (worktree `.claude/worktrees/ante-up-unify`), committed, not yet pushed/PR'd.
- One merged "Ante Up" section now holds Word Stack, Connections, Sudoku and Memory Match — the old
  "Free today"/"Ante up" split is gone (`lib/arcade/games.ts`: all four flipped from `kind: "puzzle"`
  to `kind: "wager"`, the standalone `ante-up-sudoku` catalog row deleted). Per game, per day: the
  first play is the existing shared daily puzzle (same puzzle for everyone, Word Stack's share grid
  intact) — completing it pays a skill-scored Gold bonus via new `lib/server/daily-puzzle-bonus.ts`
  (`DAILY_BONUS_BASE = 300`, matching the flat mission it replaces; a LOSS still pays the floor
  multiplier, confirmed with Kayo). After that, unlimited free replay on freshly-seeded rounds (no
  reward), or repeatable Gold wagers on freshly-seeded rounds — generalizing Sudoku's existing Ante
  Up mechanic to all three other games for the first time.
- The retired flat "Complete one brain game" mission (300 Gold, once/day, ANY one of the four) is
  disabled via migration (`mission_definitions.enabled = false` for `daily_brain_game`), not deleted
  — `player_mission_progress` keeps its history, the catalog already filters on `enabled`. The new
  bonus pays per game, per day (up to 4x what the old mission ever paid in a day if all four are
  played) — a deliberate faucet increase, confirmed with Kayo, not an oversight.
- Schema: `ante_up_attempts` generalized from Sudoku-only to all four games (migration
  `20260821130000_ante_up_unify_brain_games.sql`) — added a `game` column, renamed
  Sudoku-specific `difficulty` to a nullable generic `tier`, and the "one active attempt" unique
  index moved from `(profile_id)` to `(profile_id, game)` so the four games don't collide. The daily
  wagered-attempt cap (`ANTE_UP_..._DAILY_WAGERED_LIMIT = 10`) is per-game per-service, not one pool
  shared across all four — confirmed with Kayo, preserves what Sudoku ante-up players already had.
  `lib/server/ante-up-store.ts` is now generic (`StoredAnteUpAttempt<TState>`), mirroring
  `daily-puzzle-store.ts`'s existing "one table, many games" shape.
- Word Stack and Connections already had a natural loss condition (six guesses / four mistakes) to
  hang a wager's forfeit on, so their Ante Up engines (`lib/arcade/ante-up-word-stack.ts`,
  `ante-up-connections.ts`) need no clock — payout is skill-scored at settlement (guesses/mistakes
  used), not fixed at open the way Sudoku's difficulty-tier multiplier is. **Memory Match has no
  loss condition at all** (the board always eventually clears) — wagering on it as shipped would be
  risk-free, so `lib/arcade/ante-up-memory.ts` invents one: `ANTE_UP_MEMORY_MAX_TURNS = 20`, a turn
  cap (not a clock) that forfeits a wagered attempt that runs past it; free/daily play stays
  untimed and uncapped, matching Kayo's explicit choice of a turn-based cap over a timer.
- Each of the three new games got its own route+component (`/games/ante-up-word-stack`,
  `-connections`, `-memory`), mirroring `ante-up-sudoku.tsx`/its API routes, reusing each daily
  board's existing CSS classes rather than inventing new styling. The daily page stays the one
  catalog link target; it's expected to surface an "Ante Up" call-to-action once that day's puzzle
  is done (not yet wired into the daily board components themselves — flagged as the one remaining
  UI gap, see below).
- Fixed the actual root of Kayo's complaint: `arcadeEntryLabel()`'s bare `"Free to play"` on a
  zero-cost wager row read as "nothing is wagered here," backwards for a card that leads with a free
  daily play and then offers a real wager. Now reads `"Free daily · wager after"`.
- Not done this pass: the daily board components (`word-stack-board.tsx`, `connections-board.tsx`,
  `memory-board.tsx`, the Sudoku daily board) don't yet link to their new Ante Up sibling once the
  day's puzzle is complete — the wager routes exist and work standalone, but nothing on the daily
  page surfaces them yet. A real gap, not an oversight; next concrete step if picked up.
- Verified: 2376 tests passing (up from 2296), clean lint, clean production build with all six new
  routes present. Two pre-existing failures unrelated to this work (`memory-service.test.ts`'s
  `tsc` type-narrowing warning, `safe-area.spec.ts` — both red on `origin/main` too, confirmed by
  diffing against it before writing this note).
### The phone lobby's tab bar (2026-08-21)
- Kayo: the mobile nav "is too high up", and should look like every other app's. Two causes, both
  fixed on `feat/mobile-nav-polish`. The bar carried a row of page dots on top of it (24px of chrome
  no other app's tab bar has), and its own row was 58px, so on an iPhone the block stood 116px off
  the bottom edge. It is now a 50px row on the safe-area strip -- 84px on a notched phone, which is
  what a native tab bar measures -- and the dots are **deleted**, not hidden: the bar itself is the
  position indicator, the same as every swipeable tab bar on either platform. Don't re-add them.
- `.lobby.lobby-shell` is sized in `dvh` where `.lobby` uses `svh`. `svh` is the height with every
  browser toolbar showing, so a browser that retracts one leaves the bar floating above a strip of
  bare room. Nothing scrolls at that level (each pane scrolls on its own), so the usual reason to
  avoid `dvh` cannot bite here.
- `padding-bottom` on the bar is `max(var(--safe-bottom), 6px)`: devices reporting no inset (Android
  browsers, a narrow desktop window) would otherwise get a 50px bar sitting on the screen edge.

### Friends leaderboard: a head-to-head record per opponent (2026-08-20)
- On `feat/global-leaderboard`, on top of the same day's per-game leaderboard. Kayo's ask: "if I play
  against my girl and lose 5 times it should track." That is a different fact from anything the
  leaderboard held -- `game_leaderboard_stats` totals you against the world, and nothing anywhere
  stored "me vs her".
- New `head_to_head_records` (profile, opponent, game) + `apply_head_to_head_result`, plus
  `lib/server/head-to-head-store.ts`. Rows are **directed and written in mirrored pairs by one RPC**:
  A's row and B's row land in one statement, so "my record vs my friends" is one primary-key-prefix
  read with no `or()` and no flipping anyone's wins into losses at read time. The mirror is an
  invariant (A.wins vs B == B.losses vs A), which is why an N-way cribbage table records only
  winner-vs-each-loser -- two players who both lost get nothing against each other, since recording a
  loss on both sides would have each holding a loss to the other.
- **No new settlement call sites.** `recordDuelResult`/`recordMultiWayResult` (leaderboard-store) fan
  the same result out to the head-to-head store themselves. One settled match is one event; two call
  sites is how the world board and the friends board end up disagreeing. Membership is
  `isHeadToHeadGame` = the game's own `kind === "win_loss_record"`, so a future duel joins both boards
  on the same single registry entry. Memory Match (no opponent) and poker (a pot at a six-handed table
  is not a result between two named players) are never written.
- The migration **backfills** from settled `pvp_matches` and completed `cribbage_tables`, streaks
  included (run-length off the latest result, gaps-and-islands for the best one) -- history that
  already happened shows up the day it deploys instead of everyone starting 0-0. Verified against a
  throwaway Postgres 17 container with stub tables, not just eyeballed: 1-5 with L5, mirrors exact,
  active matches excluded.
- The friends drawer's own W-L badge was repointed off `getDuelRecordsAgainst` (derived by scanning
  the last 500 matches, duels only) onto this store, and that function is deleted. One source now
  feeds both, and `formatRecord`/`formatStreak` are shared out of the leaderboard contract so the
  badge and the board can't spell the same record two ways.
- A per-friend **overall** streak is only reported when a single game accounts for every result. The
  ordering across games isn't recoverable from per-game counters, so the row leaves it blank and the
  expanded per-game rows carry the streaks instead -- deliberate, not an oversight.
- UI: a third cross-game tab ("Friends", after Poker/Global), rows expanding into the per-game split.
  Friends you have never played stay on the board as "No games yet" (that's the thing it exists to
  fix). Watch the base `.leaderboard-row` mobile rule -- it hides children 5 and 6, which on this row
  are the streak and the chevron; `.leaderboard-row-friend` has to `display: revert` them back.

### The five retired casino games are gone, not just retired (2026-08-20)
- On branch `chore/delete-retired-casino-games` off main. Roulette, Video Poker, Coin Flip, Baccarat
  and Hi-Lo were retired 2026-08-12 (blocked from play, code and routes left mounted, per the
  reasoning `lib/arcade/retired.ts`'s guard existed for) — Kayo's explicit follow-up call: "hi lo
  shouldve been deleted from my repo and all reference files a while ago," extended to the whole
  retired family, not just Hi-Lo. Deleted outright: each game's engine, service, API routes, page and
  table component (38 files), plus their five per-game CSS sheets.
- Cascaded one level further than the five games themselves: `lib/server/casino-round-service.ts`
  (the shared wallet path for Roulette/Video Poker/Coin Flip/Baccarat — Blackjack and Hi-Lo were
  always on their own independent copies, never migrated onto it) had zero real callers left once its
  four consumers were deleted, so it went too, along with the client-side counterpart nothing had
  actually adopted either (`components/arcade/{use-casino-machine.ts,arcade-hud.tsx}`,
  `lib/arcade/hud.ts`, `28-arcade-hud.css`) — confirmed dead by grepping for real importers before
  deleting, not inferred from the games list.
- `lib/arcade/retired.ts`'s guard mechanism stays — deliberately not deleted. It's the documented,
  reusable way to retire a *future* game without a same-day code deletion; `RETIRED_ARCADE_GAMES` is
  just `[]` now. Don't re-delete it if it looks unused; unused-with-nothing-currently-retired is its
  normal resting state.
- Every comment citing one of the five as a naming-convention example (there were ~20, across
  services, components, CSS headers and two lines of user-facing copy on the sign-in page and the
  first-run onboarding step) got reworded to a still-live example or a self-contained explanation,
  not left dangling. `lib/progression/rank.ts`'s "stay under the house's edge" framing was rewritten
  more substantively than a name-swap: there is no house edge left anywhere in this economy at all
  (every staked game is winner-take-all PvP with no rake), so the real constraint is now stated as
  "don't undermine what a real-money Gold purchase is worth" instead of citing a specific retired
  game's payout table.
- Supabase migrations mentioning these games in their own header prose were left untouched —
  migrations are append-only, same precedent as the Word Stack rebrand's Wordle-naming migrations.
  No dedicated table existed for any of the five (all shared `arcade_rounds`); their historical rows
  there are orphaned, not deleted, which is the accepted cost of that table's own append-only design.

### Daily Wordle renamed to Word Stack (2026-08-19)
- Trademark cleanup, on branch `feat/word-stack-rebrand` off main (a separate worktree, uncommitted):
  the daily 5-letter puzzle no longer carries Wordle's name anywhere -- catalog id `daily-word-stack`,
  route `/games/word-stack`, API at `/api/arcade/word-stack`, every internal identifier/CSS class/test
  renamed to match (`lib/arcade/puzzles/word-stack.ts`, `word-stack-answers.ts`,
  `word-stack-dictionary.ts`, `lib/server/word-stack-service.ts`,
  `components/arcade/word-stack-board.tsx`). A new migration
  (`20260819100000_rename_wordle_mission_copy.sql`) updates the one live-DB row the old name had
  leaked into (the `daily_brain_game` mission's description); the two migrations that shipped the
  original feature keep saying "Wordle" in their own historical prose, since migrations are
  append-only and that text is internal, not user-facing.
- Tile colors: correct stays green and present stays gold (`#2f7d4f`/`#b8952f` -- the app was already
  off Wordle's yellow before this pass). Only `absent` changed, from a greenish-grey
  (`#39443f`/`#232b28`) to a real blue-grey (`#3d4656`/`#262e3a`) matching `--brand-ink-lift-2`'s
  chrome tone. The share-sheet emoji grid swapped its yellow present block (🟨) for orange (🟧) to
  match -- there is no "gold" square emoji, and 🟦 was rejected since Connections already uses it for
  one of its own four tiers and reusing it here would read as that game's color, not this one's.
- Answer pool grown 751 → 1,119: candidates were hand-authored common 5-letter words, then
  mechanically verified against the existing guess dictionary (word-stack-dictionary.ts's ~15k-word
  allow-list) and deduped against the existing pool and each other -- not hand-verified one by one.
  Plurals and two words that turned out non-standard on a second look (`dawdy`, `calor`) were dropped
  even though both were technically dictionary-legal, per the file's own "never ask for an obscure
  word" rule.

### Cribbage: a 3-4 player free-for-all table (2026-08-18)
- Kayo's brother plays cribbage with a group, not 1v1 — this is a new N-seat (3 or 4), Gold-wagered,
  winner-take-all table, not a fifth `lib/pvp/` duel. `pvp-match-service.ts`/`pvp_matches` are
  2-player at every layer (`DuelSeat = 0|1`, `player0_id`/`player1_id` fixed columns, a trigger
  written for exactly two ordered columns), confirmed by reading it before building anything —
  cribbage gets its own parallel contract/store/service instead: `lib/cribbage/table-contract.ts`
  (no registry — one N-seat game doesn't justify one), `lib/server/cribbage-table-store.ts` +
  `cribbage-service.ts`, `cribbage_tables`/`cribbage_table_players` (a join table, mirroring
  `game_seats` — the one existing precedent for "N humans at one row" — not a `players uuid[]`
  column). Full standard rules: deal 5, discard 1 each to the crib (3-handed burns one extra card
  from the deck so the crib is still exactly 4; 4-handed's 4×1 already is), pegging to 31, hand+crib
  counting, race to 121. Counting has no player decisions in it, so there is no "counting" phase or
  move — the instant pegging empties every hand, `lib/cribbage/engine.ts`'s `concludeHand` scores
  everything automatically (non-dealers in turn order, then the dealer, then the dealer's crib,
  stopping mid-count the instant someone crosses 121) and deals straight into the next hand.
- A table caps at 4 and auto-starts the instant the 4th seat fills; once 3 are seated the host gets
  a manual "Start now" button instead of waiting. Both routes through the SAME status-guarded
  Postgres function (`deal_cribbage_table`) — one code path that can deal a hand into existence, per
  the same reasoning `advancePvpMatch`'s version guard exists for. Human-only, like the duels — no
  bot fill, unlike poker's continuous tables (an explicit call, not an oversight: a bot winning a
  share of a real Gold pot was judged worse than a table someone has to wait on).
- New `DomainEvent` kind `cribbage_won`, not folded into `duel_won` — that event's own catalog copy
  says "PvP duels" ("Win 10 PvP duels"), and silently counting a 3-4 player table against it would
  misword shipped text and dilute a metric that means something structurally different (always 1v1).
  `cribbage_hands_won` mission/achievement plumbing is wired (`lib/missions/events.ts`,
  `lib/achievements/events.ts`) with **no catalog rows yet** — `apply_achievement_counter` accumulates
  with no catalog row required, so tiers can land in a later migration without touching code again.
- Discovery is an open-table list (create/join, closer to poker's quick-play), not the friends
  drawer's single-target `?challenge=<id>` picker — that flow has nowhere to carry 2-3 extra invitees.
  Inviting specific friends to a cribbage table is a real gap, same class as the existing "no
  pick-a-friend-and-invite flow for duels either" gap this file already tracked. Also not done this
  pass: blocking a blocked/blocking relationship from joining someone's open table (the duel flow
  checks this for a direct challenge; an open table has no single target to check against without
  scanning every seated player, and it was cut for scope, not forgotten).
- Resigning ends the WHOLE table immediately (pot to whichever remaining seat has the higher score)
  rather than letting the rest keep playing — cribbage's pegging/counting order depends on every
  seat, so there is no well-defined "the other 2-3 keep going" the way a poker fold has. A genuine
  judgment call, flagged as one in `lib/cribbage/engine.ts`'s `resignCribbage`.
- Stake reuses `MIN_DUEL_STAKE` (the same floor Chess/Checkers/etc. use), not a new tier ladder.
- Caught by `engine.test.ts` before it ever touched money: hitting exactly 31 during pegging has to
  reset the count IMMEDIATELY, even while another seat still holds a card that would have fit — a
  first draft only reset once *everyone* was stuck (conflating 31 with a "go"), which let pegging
  continue past 31 as if the count were still live.

### Site footer + info pages (2026-08-16)
- Kayo wanted the lobby to feel like "a genuine web gaming platform" (PlayPokerGO's menu was the
  reference) rather than a single-purpose app. Root problem: five `/legal/*` pages already existed
  (terms, privacy, gold-disclosure, support-disclosure, disclaimer) with nothing anywhere in the app
  linking to any of them.
- Added a lobby-only `SiteFooter` (`components/nav/site-footer.tsx`, mounted at the bottom of
  `components/lobby/lobby.tsx`'s `.hub`) plus four new pages it and it alone points at: `/about`,
  `/help` (FAQ + contact), `/how-to-play` (hand rankings, hand structure, duel summary), and
  `/rewards` (every Gold source in one place). Deliberately **not** in `components/nav/menu.tsx`'s
  dropdown or on the table — the menu is account actions opened on demand, the footer is a trust
  surface that should be visible without opening anything, and none of it belongs mid-hand.
- `/rewards` is wayfinding, not a second claim surface: it fetches `/api/profile` (same deferred-timer
  shape as `arcade-floor.tsx`) to show a live Gold balance and each source's claim state, but every
  "claim" link routes back to where the action already lives (the lobby's player menu, `/challenges`,
  `/store/gold`) rather than re-implementing `claimDailyGold`/rewarded-ad/backstop calls a second
  place for the money-ordering rules to be gotten wrong in.
- `/about`, `/help`, `/how-to-play` reuse the `/legal` shell (`.legal-page`) rather than a new layout;
  `/rewards` reuses the arcade floor's `.floor-shell`/`.floor-card` shell. New CSS is
  `43-site-info.css` — only the footer itself plus the list/FAQ styling those two shells never
  needed before.
- `middleware.ts`'s matcher gained `about|help|how-to-play` alongside the existing
  `legal/|store|leaderboard|collection` static-page exclusions (pure content, no server-session
  read). `/rewards` was deliberately left in the auth-refreshing set, matching `/games` and
  `/challenges` — it does read a profile.

### In progress (2026-08-12)
- Three click sounds (`lib/audio/ui-sounds.ts`: `tapSound()`/`selectSound()`/`gameOnSound()`) replaced
  the old single `ui` cue with three call sites; wiring is centralized in `components/nav/menu.tsx`
  (the one dropdown behind both the lobby and table menus). `gameOnSound` is **edge-triggered** off
  `game` going null→truthy in `poker-app.tsx` (its own `wasSeatedRef`) — it must stay edge-triggered,
  since `game` changes identity every poll/tick/action. `select` plays a **trimmed** 0.25s cut
  (`Select_Tap.mp3`); the untrimmed source holds two taps and reads as a double-click.
- Fixed three remount bugs caused by `/games/*` (arcade, Collection, leaderboard) being separate
  routes that fully unmount `PokerApp`: a login-screen flash on return to the lobby (fixed via
  `lib/profile/session-continuity.ts` — **sessionStorage only, never localStorage**, since a stale
  hint there could wave a guest through past an expired real session), a duplicate "Welcome back"
  toast (a ref that emptied on remount, now keyed off the account id instead), and
  `key={profile.updatedAt}` on `<Lobby>` rebuilding the whole hub grid on every profile write
  (removed; the one thing that needed it — the buy-in name field seeding from `displayName` — is now
  a derived override instead of remount-seeded state).
- House gambling games (roulette/video-poker/coin-flip/baccarat/hi-lo) retired; PvP duels added
  (Chess/Checkers/Trivia Showdown/Word Race, 1v1 winner-take-all, `/games/{chess,checkers,trivia,word-race}`).
  Retiring a game is a **server guard** (`lib/arcade/retired.ts`, enforced on each service's deal
  path), not just a catalogue/link removal — the POST route stays mounted. Duel safety is
  balance **conservation** (`pvp-match-service.ts` — sum of both players' balances is invariant),
  not a house edge; escrow on an open challenge must release **exactly once**, via a status-guarded
  write that returns the row at most once — paying out on a null return turns a double-tapped Cancel
  into free Gold. New `spend_gold_by_profile`/`credit_gold_by_profile` RPCs move Gold to/from a
  profile that isn't the requester (a duel's settler is often the loser, or neither player on a
  timeout) — every prior Gold RPC keyed on `session_token`, which assumed mover === moved-to.
  **`tick()` on every duel engine must return null when nothing changed**, or it livelocks both
  players' optimistic-concurrency guard against the shell's 2s poll; every engine has a test pinning
  this. Puzzle-answer banks (`trivia-questions.ts`, `word-race-words.ts`) are `server-only` — Word
  Race's wasn't at first and its 478-word bank shipped into the client bundle, a one-line anagram
  lookup away from cheating a game that settles real Gold; verify with a probe-string grep of
  `.next/static` after a real build, not by reading imports.
- 3D room now gates its "ready" state on every seated avatar's `.glb` actually mounting
  (`lib/game3d/avatar-load-gate.ts`), not on "the WebGL context exists" — fixed avatars popping in
  seat-by-seat after the room announced itself done. Gesture playback is a pure transition machine
  (`lib/game3d/avatar-playback.ts`), addressed by gesture epoch and driven in scene-clock seconds —
  fixed a one-shot gesture (e.g. a bet) getting trapped on its last frame forever when a new hand
  started mid-animation and the deferred hand-back's own effect re-ran and cancelled itself. Avatar
  roster is meshopt-compressed (18MB→7.9MB); `useGLTF(url, false, true)` supplies the decoder — drop
  that third argument and every avatar silently breaks at runtime while tsc/build stay green.
- 3D room got a real modelled backdrop (`public/environments/stackchips-room-surround.glb`,
  `components/game3d/scene/room-surround.tsx`) — only its short balustrade ring is mounted (checked
  against the real camera frustum at every shipped aspect); its taller walls stay off-frame at every
  angle, and a second supplied full-scene GLB was left uninstalled since it duplicates the app's own
  table. Not routed through `buildInstancedProp` — that helper's metalness clamp is tuned for the
  chip roster and would dull this asset's brass trim, and nothing here repeats to instance.

### Economy/retention redesign, milestone 1: missions (2026-08-14)
- Kayo's directive: redesign the economy around progression/collection/achievement, not
  monetization (Gold is no longer sold for cash — see below). Sequenced one milestone at a time;
  missions shipped first. Remaining, not yet planned: achievements/badges, streak recovery,
  cosmetic categories beyond avatar/card-back, a "brain games" identity, non-win celebrations.
- Daily/weekly objectives, auto-credited on completion — no claim button, unlike the daily Gold
  grant. New `mission_definitions`/`player_mission_progress`/`mission_reward_grants` tables plus
  `apply_mission_progress`/`grant_mission_reward` RPCs, same row-locked shape as
  `award_progression_xp`. `lib/missions/events.ts` is the one place a domain event fans out to every
  mission it feeds (poker hand played, duel won, puzzle completed, level gained) — hooks land beside
  the *existing* `awardWager` call sites, not new ones, plus one addition inside `payOutMatch` for
  duel wins (which `awardWager` never covered — XP there is earned once at accept time, not on the
  outcome). `lib/server/mission-store.ts` never throws, same contract as `awardWager`.
- `profile_badges` (populated by season rollover) and four cosmetic catalog entries
  (`back-riverwood`, `avatar-housename`, `avatar-finaltable`, `avatar-ace`) already have
  achievement-shaped descriptions but nothing grants them — surfaced for the next milestone, not
  touched by this one.
- Milestone 2 (achievements/badges) has since shipped (PR #100/#102). Remaining, not yet planned:
  streak recovery, cosmetic categories beyond avatar/card-back, a "brain games" identity, non-win
  celebrations.

### Voluntary support payments replace Buy-Gold (2026-08-13)
- The Gold storefront (`components/store/gold-store.tsx`, the general tier ladder, and the legacy
  one-click rebuy Checkout Session) is gone, replaced by `components/store/support-panel.tsx` at the
  same `/store` route. Every support tier — one-time or monthly, three price points — grants nothing:
  no Gold, no gameplay effect, matching `lib/legal/documents.ts`'s `support_disclosure` exactly. Don't
  add a Gold reward or gameplay perk to a tier without updating that disclosure first; a purely
  cosmetic, gameplay-neutral perk (a name badge) would be fine and would just need a version bump.
- `fulfill_stripe_payment` no longer assumes every payment credits Gold — crediting is now
  conditional on `kind`, and `support_one_time` inserts its `stripe_payments` ledger row (audit +
  idempotency) without ever reaching the `profiles` UPDATE. `gold_amount` is nullable now.
- Monthly support is real Stripe Billing (`mode: "subscription"` Checkout Sessions), not repeated
  one-time charges. New `stripe_subscriptions` table mirrors Stripe's own subscription state — a
  mutable row upserted per lifecycle event via `upsert_stripe_subscription`, recency-guarded on the
  originating event's own `created` timestamp (never `Date.now()`) so a redelivered/out-of-order
  webhook can never regress a newer status. This is a different idempotency shape from every other
  money RPC in this file: `stripe_payments`/duel escrow are settle-once ledgers where "someone already
  did this, return false/null" is the terminal answer; a subscription is a live status mirror, so a
  guard failure still returns the current row rather than nothing.
- Cancellation goes through the Stripe Customer Portal (`/api/stripe/portal-session`) — no custom
  in-app cancel flow. Two Stripe SDK landmines worth knowing before touching this code again:
  `current_period_start`/`current_period_end` live on `subscription.items.data[0]`, not the
  `Subscription` root; `invoice.subscription` doesn't exist — it's
  `invoice.parent?.subscription_details?.subscription`. Both are silently `undefined` if read the
  obvious way.
- The busted-mid-table "Buy Gold to rebuy" button (skipped straight to Stripe Checkout) is gone —
  there is no purchase escape valve left anywhere. `action-bar.tsx`'s busted state now offers the
  backstop top-up inline (`onClaimBackstop`, same mechanism as the lobby's own banner) when eligible,
  falling back to "Return to lobby" (where every faucet lives) otherwise. See "Bot / economy behavior"
  above for why no faucet number needed to change.

### The 2.5D racetrack table (2026-08-13)
- Third table renderer, `racetrack_2d5` / "Table: 2.5D", alongside `canvas_2d` and
  `webgl_3d`. A third entry rather than a replacement for `canvas_2d` on purpose:
  the classic table is what `resolveTableRenderer` falls back to when a browser has
  no WebGL context, so it has to keep working. Promote it once it has been judged in
  real hands.
- **It is camera-led where every other table is CSS-led, and that inversion is the
  whole design.** The classic room has `.poker-rail` carrying the felt as background
  art with seats on a hand-tuned CSS ellipse, and the canvas measures that rail to
  place chips inside it. Here `fitCamera` solves a perspective camera from the frame,
  the canvas paints the entire table from it, and the DOM follows anchors the scene
  projects and reports through `onLayout`. A perspective ring and a CSS ellipse are
  not the same kind of curve and cannot be tuned into agreement — one has to be
  derived from the other. `42-racetrack-table.css` collapses `.poker-table-wrap` onto
  `.table-area` so canvas pixels and wrap pixels are the same number.
- Shared with the classic room through three seams rather than forked: `SceneProjection`
  (one chip painter for both cameras — `scaleAt()` is the entire difference, constant
  under orthography and depth-dependent under perspective), `ChipSpace` (ChipLayer no
  longer imports the classic ellipse directly), and `seatAnglesDeg()` (the measured
  six-handed arc generalised to 2-6 players, reproducing the 3/2 split exactly at six).
  **Both spaces speak the chip layer's world units**; the racetrack's metres convert
  once, at the projection. Converting the layer to metres means rescaling a dozen
  tuned motion constants and missing one yields a chip that never settles, not an error.
- `99-scene.css`'s canvas raise is scoped away from this room as well as the 3D one.
  Unscoped, the canvas paints over every seat, nameplate, card and the board — and the
  symptom is a correct but *empty* table, which reads as "the players failed to load".
- `ringPoint` traces the **inscribed ellipse**, not the stadium boundary, and is inside
  it by up to 23mm on this 2:1 table. Any anchor that must be a known distance *outside*
  the felt needs `offsetStadium` plus `stadiumRayPoint`; scaling radii is only exact on
  a real ellipse. This shipped a bet tray 29mm inside the cloth before it was caught.
- **Landscape-only.** A 2:1 table has no portrait framing — at 390×844 the felt is ~58px
  deep with the nameplates on the cloth — so `resolveTableRenderer` sends the preference
  to `canvas_2d` in portrait. A quiet fallback, never a rotate-to-play gate: an overlay a
  player cannot act through times their turn out and folds them, which is too high a
  price for a cosmetic preference. Nothing rewrites the stored choice, so rotating brings
  it straight back — `useLandscape` (`components/use-landscape.ts`) is a live `matchMedia`
  subscription built like `useWebglSupport`, not a snapshot taken at mount, and
  `racetrack-landscape.spec.ts` pins the rotation because a subscription that never fires
  is indistinguishable from one that does until the device is turned.
- The table menu cycles from the renderer **actually mounted**, not the stored preference.
  They differ exactly when a preference has been resolved away (3D without WebGL, 2.5D in
  portrait), and stepping from the stored value there produces an entry that visibly does
  nothing — it lands on what is already on screen.
- Offered in the buy-in preselect as a third `.entry-segment` button, disabled in portrait
  rather than hidden (same treatment the 3D room gets without WebGL). `.entry-segment` is
  a two-way control by construction, so the three-up grid is overridden under
  `.buyin-renderer` rather than generalised.
- **The dealer** sits at far centre, drawn OVER the cloth rather than behind the rail —
  the art puts hands on the table and painting it under removes exactly that. z-index 3:
  above the canvas, below every seat. See the single-dealer entry dated 2026-08-21 below
  for who she is and what replaced the rotation that used to live here.
- **Redrawing the dealer must never need a number.** Drop a plate in `art/dealers/`, run
  `scripts/prepare-dealer.py`; it keys, normalises and regenerates
  `public/table2d5/dealer.webp` plus `lib/scene/dealer-art.generated.ts`. Normalising is
  what lets the app hold ONE placement (`DEALER_SLOT`) instead of per-plate landmarks: the
  plate is scaled so its crown-to-hands height fills a known box and centred on the
  alpha-weighted middle of its head band. The plate must be framed head-to-hands running
  off the bottom edge — that framing IS the contract, and an offset appearing in
  `table-dealer.ts` means the plate is wrong, not the code.
- Placement anchors to the top of the HAIR, not the measured skull — `fitCamera` reserves
  its top margin against head points and hair is what occupies it; anchoring the skull
  clips a ponytail or a pair of ears and lands the hands on the rail instead of the cloth.
  The slot's size comes from the projected gap between the two chairs flanking the dealer,
  so it grows with the table like everything else rather than being pinned in pixels.
- Every plate so far arrived RGB-on-a-black-plate with a black shirt, and Loki is a black
  dog: the cutout floods **inward from the border at luma ≤ 1**. Any colour key — or one
  step more generous than 1 — escapes through the clothing and eats the figure (see
  `[[reference_stackchips_avatar_assets]]` for the full recipe).
- Known and deliberately unresolved (a design call, not a defect): a ~140px band of floor
  below the near rail near 16:9 — taking it up by lowering the camera was tried and
  reverted because it wrecks every taller frame.
- `.poker-table-wrap` has `isolation: isolate` (for 99-scene.css's canvas-raise trick) but no
  z-index of its own — normally harmless, but it means the whole felt (board, every seat) sits
  in the CSS stacking "level 0" bucket, which **always loses to any sibling with an explicit
  positive z-index** — `.racetrack-dealer` (z-index 3) — no matter how high a *descendant's*
  own z-index is raised; isolation traps it. Only fix is an explicit z-index on
  `.poker-table-wrap` itself (now 4, matching the far seats' own floor). Found via the pot
  label (2026-08-14): raising `.poker-rail` to 20 had zero visible effect, confirmed a real
  paint bug (not test tooling) by sampling actual pixels — `document.elementsFromPoint` is
  useless here since most of this subtree is `pointer-events: none`.
- The board itself was still unsized (2026-08-14): `.community-cards` had no racetrack override at
  all, so it was inheriting the classic room's breakpoint clamp (`clamp(56px, 4.4vw, 76px)` on
  desktop, plus its pill padding/border) — a 429px-wide row at the ceiling, on a felt whose real
  63mm-card math (`BOARD_CARD_WIDTH_M`, table-anchors.ts) says a card should read as ~6% of the
  cloth. `.board-stack` also carried the classic room's `z-index: 7`, above every seat (4–6) — so
  that oversized row could paint over a seat's own cards/plate wherever the two overlapped on
  screen, not just the pot. Fixed three ways: the row is now sized from the same camera projection
  as everything else on this table (`RACETRACK_BOARD_CARD_MIN/MAX_PX`, 44–52px, floor matches
  `12-responsive.css`'s own proven card-legibility floor); the flop's three cards overlap each
  other 20% (a laid fan) while the turn/river keep the normal reveal gap, which is most of the
  footprint reduction; `.board-stack` gets an explicit `z-index: 2` for this room (above the canvas,
  below the dealer and every seat, same "furthest person still wins" rule the dealer already
  follows). `lib/scene/board-clearance.ts`'s `clampBoardCardWidth` shrinks the row further still,
  every frame, until its real rendered footprint clears the live screen-space gap to the pot —
  a fixed CSS margin can't do that job because the gap between the board and pot anchors changes
  with every camera fit, not just with screen width.
### One dealer on the 2.5D table: Claira (2026-08-21)
- Kayo supplied a portrait of his girlfriend holding both dogs and asked for her as "the sole
  dealer person," with the rotation "cut out completely." Scoped mid-pass to **the 2.5D table
  only** — Blackjack's own dealers (`lib/arcade/dealer.ts`, `dealer-scene.ts`, `dealer-stage.tsx`,
  `public/dealer/{loki,finn}.webp`) are deliberately untouched, so the app currently has two
  different dealer identities on two different surfaces. That is a known, chosen split, not drift.
  Extending her to Blackjack is the obvious next step if it is ever wanted.
- The rotation is **deleted, not reduced to a roster of one**: `dealerForHand`, `HANDS_PER_DOWN`,
  `DEALER_IDS` and the table-id hash are gone, along with `lib/scene/dealer-roster.ts` itself
  (now `lib/scene/table-dealer.ts`, holding only `DEALER_SLOT`/`dealerSlotBox` and re-exporting
  the generated `DEALER_ART_SRC`). A rotation that never rotates is machinery a reader has to
  disprove. `poker-table.tsx` lost its `key={dealerId}` remount trick with it — there is no
  outgoing bitmap to cross-fade any more.
- `HANDS_PER_DOWN` had a **second consumer**: `seat-art.ts` rotated the opponent seats' cast on
  the dealer's own cadence, deliberately, so the whole table changed together. That rotation is
  about players, not the dealer, so it stays — the constant moved into `seat-art.ts` as
  `HANDS_PER_CAST` (same value, 8). Deleting it outright would have silently frozen every
  opponent seat's character for the life of a table.
- `scripts/prepare-dealers.py` → `scripts/prepare-dealer.py`, one plate in, one file out
  (`public/table2d5/dealer.webp`). Its keying **auto-detects plate polarity** from the border
  ring's median luma, because this plate arrived white-on-JPEG where all three previous ones were
  RGB-on-black. Dark plates still flood at luma ≤ 1 (unchanged, and still not a knob); a light
  plate floods at luma ≥ 200, measured rather than guessed — between 245 and 200 the kept-pixel
  count moves 0.17%, because the illustration carries a hard dark outline all the way round, so
  the looser threshold puts the cut on the outline instead of on a rim of near-white JPEG ringing.
  Interior highlights (eye whites, teeth) survive because a border flood can never reach them.
- **Two plates were supplied in the same session and the second replaced the first.** The first was
  her holding both dogs, on a white JPEG plate, 752×1005 of figure. The second — the one that
  shipped — is a labelled "ANGLE SHEET / front" on a black JPEG plate: her alone in house uniform,
  no dogs. Both go through the same script; between them they exercise every branch of it, which is
  why the light-plate path is still tested by hand against the old file before a change lands.
- Three things the second plate forced into `prepare-dealer.py`, all of them general rather than
  one-off:
  - **A dark JPEG plate cannot key at luma ≤ 1.** At that threshold the flood dies in the ringing
    and the whole sheet comes out opaque. The threshold is now picked by FILE FORMAT, not just
    polarity: lossless dark stays at ≤ 1 (the old hard-won rule, protecting a black shirt with
    literal (0,0,0) in it), lossy dark goes to ≤ 6. Same number and same reason as
    `slice-seat-sheet.py`. Measured: the cut bbox is identical at 4, 6 and 10, so 6 is mid-plateau.
  - **A labelled sheet is now a valid plate.** The figure is isolated first as the tallest run of
    non-background rows, so a boxed title above and a caption block below are out-grown rather than
    located. Without this the alpha bounds span the whole sheet and the dealer ships as a stamp in
    the middle of a mostly-empty box. No-op on a plain plate.
  - **It never upscales.** `BOX_HEIGHT` became `BOX_MAX_HEIGHT`, a ceiling. This plate's figure is
    only 303×478, and blowing it up to the old fixed 794 would ship a bigger, blurrier file with no
    more detail in it. `DEALER_BOX` is now 306×478.
- **Resolution is marginal on a large hi-DPI desktop, and that is the art, not the pipeline.**
  Measured from the running app at DPR 2: 1920×1080 draws her 553 device px tall against a 478px
  source (0.86× — a slight browser upscale), 1440×900 gives 1.13×, landscape phone 2.09×. If she
  ever needs to be crisp on a big display, the fix is a sheet whose figure fills more of the frame
  (or a 2048 render), not a change here.
- The name badge in the artwork reads **ELENA**, not Claira. Illegible at the size she actually
  draws (the badge is ~2px there), but it is in the file. Flagged for Kayo, not silently renamed —
  nothing in code keys off her name, it appears only in comments.
- Verified in a real browser at 1920×1080, 1440×900 and 844×390 (landscape phone): she sits behind
  the rail with her hands on the cloth, scale matches the flanking seats, cutout clean against the
  room.
- `public/table2d5/dealer.png` — the pre-rotation single-dealer file that commit 21219be
  un-deleted and explicitly left for "whoever lands that work" — is finally deleted here, since
  going back to one dealer is exactly that.
- Verified: `npx vitest run` 2324/2324 green, clean lint, clean production build, `tsc` clean
  apart from the pre-existing `safe-area.spec.ts` failure.

### The avatar collection and the racetrack seat-art roster became one system (2026-08-17)
- Seat-art roster grown to 11 characters. `character6`–`character11` joined `character1`–`character5`
  in `lib/scene/seat-art.ts`'s bucket, built from a single 6-up grid sheet per angle
  (`scripts/prepare-seat-art.py` takes one character per source directory, not a sheet — each sheet is
  pre-cropped by hand into six `art/seats/characterN/<angle>.png` files first). `character6`-`character11`
  currently only have a `0deg` plate; `pickSeatArt`'s `forceAngle` used to assume every character had
  whatever angle a seat override named and would request a file that doesn't exist for a single-angle
  character — fixed (`seatArtCharacterForSlot`'s `forcedAnglesForSlot` filter, plus `pickSeatArt`
  itself) to keep a character out of a seat whose override forces an angle it doesn't have, and to
  fall back to the normal magnitude-based pick rather than requesting a missing file.
- Same day, the same 11-character roster became the *entire* `avatar` cosmetic slot, replacing the old
  20-entry illustrated catalog (`avatar-regular`…`avatar-ace`) outright — art and catalog both. An
  earlier pass at exactly this same deletion, same day, got fully reverted mid-conversation because it
  landed uncommitted, unauthorized, and half-finished (empty `/collection`, no purchase path, no
  per-player wiring); this is the real, complete version, confirmed piece by piece with Kayo before
  landing. **One id space now does three jobs**: `characterAvatarCosmetics`
  (`lib/cosmetics/catalog.ts`) sells/equips `character1`-`character11` through the existing generic
  purchase/equip path (character1-5 free, character6-11 a Gold ladder, same RPC everything else
  already used — no new migration); `avatarFigure`/`avatarFace` both resolve to the character's own
  `seatArtSrc(id, 0)` plate (one image now serves the store card and every small-circle avatar,
  header/lobby/profile/HUD, since a seat-art plate is already framed head-to-hands); and
  `poker-table.tsx`'s racetrack seat renderer reads `seat.avatarCosmetic` directly
  (`seatArtCharacter(seat.avatarCosmetic) ?? seatArtCharacterForSlot(...)`) instead of always hashing —
  a seated player's actual equipped character is what's drawn at their opponent seat now, the hash
  pick only survives as the fallback for an unresolvable id. `botAvatarFor` (`lib/game/engine.ts`) had
  to be repointed from the combined `avatarCosmetics` (2D+3D, would occasionally hand a bot a 3D-only
  id in its 2D slot) to `characterAvatarCosmetics` alone, or that per-player wiring would silently
  fall back to the hash pick for whichever bots landed on a 3D id.
- `/collection`'s preview dialog gained an angle switcher (`previewAngle` state, buttons per
  `seatArtCharacter(id)?.angles`) — a buyer can turn a character before spending Gold on it. Only
  renders when a character has more than one angle, so character6-11 show nothing extra today and
  gain the row automatically the moment wider turns ship — no code change needed for that later.
- `art/avatars/`, `public/avatars/`, `scripts/prepare-avatars.sh` are deleted, not just their catalog
  entries — `art/seats/`/`scripts/prepare-seat-art.py` is the only avatar art pipeline left.
  `biggest_pot_50k`'s `avatar-housename` cosmetic reward repointed to Gold-only again (same fix as the
  reverted attempt), same for its not-yet-deployed migration (confirmed absent via
  `list_migrations` before editing directly).

### Seat-art roster grown to 15, then 21, and a slicer for the sheets (2026-08-21)
- `character13`-`character15` added. Kayo now supplies a character as ONE labelled 3-up JPEG
  turnaround sheet (0/20/40 side by side, captions above and below each panel), not as pre-cropped
  per-angle files, so `scripts/slice-seat-sheet.py <sheet> <id>` does the cutting before
  `prepare-seat-art.py` runs. It finds the figure band as the tallest run of non-black rows (captions
  are short bands, so they never have to be located, only out-grown), splits on the gutters, and keys
  each panel by flooding in from its border.
- **It floods at luma <= 6, not `prepare-seat-art.py`'s <= 1, and that is the entire reason it
  exists**: these sheets arrive as JPEG and the "black" plate carries ringing up around 6, so the
  stricter flood stops at the noise and the plate comes out a solid opaque rectangle. It writes real
  alpha, which `prepare-seat-art.py` detects and passes through instead of re-keying. Connectivity is
  still the key, not colour — a colour key at any threshold eats the dark hair and the black chair.
  Stray islands (ringing across a gutter) are dropped, or they widen the character's normalised box
  for nothing.
- Every roster entry needs a `characterAvatarOffers` entry in `lib/cosmetics/catalog.ts` —
  `characterAvatarCosmetics` throws for one without, deliberately, rather than falling through to the
  free-starter default. Names and copy are first-draft, written from the art; nothing keys off a name.
- **These three are EARNED, not sold** (Kayo's call, same day, right after they landed): a third tier
  under the existing standard/rare ones — `price: null` plus `unlock: { handsWon }` at 250/750/1,500
  lifetime hands won, rarity `signature`. No new machinery: `lib/server/avatar-unlocks.ts` already
  sweeps every `avatarCosmetics` entry carrying an `unlock` after each hand, `purchaseCosmetic`
  already refuses a null price, `equipCosmetic` already demands ownership, and the Collection already
  renders the progress bar. The only real code change was the tier derivation —
  `price > 0 ? "rare" : "standard"` puts a null-priced item in the FREE bucket, so an earned character
  would have shipped as a starter giveaway.
- Bots no longer draw from the whole character roster: `botAvatarCosmetics` excludes the earned tier
  (`botAvatarFor`, `lib/game/engine.ts`). Same reasoning `botCardBacks` already stopped bots at
  standard-tier decks — a bot wearing a face a player is 1,500 won hands away from says the threshold
  buys nothing anyone can see. Gold-priced characters stay in the bot pool on purpose; those
  advertise the store rather than making a claim about history at this table.
- Six more the same day, `character16`-`character21`, from six more 3-up sheets through the same
  slicer with no script change. Kayo's call on the tier: **extend the Gold ladder, not the earned
  one** — the signature tier stays exactly the three rungs it was set at, 250/750/1,500 hands, rather
  than growing to nine and diluting what it means.
- The new rungs step by ~20% each (9,000,000 up to 17,000,000) where `character6`-`character12` step
  by ~60%. That is a deliberate break, not a slip: the original ladder was already decelerating
  (×1.75 down to ×1.50 by its last rung), and holding ~60% past `character12` would land the top at
  about 85,000,000 — an order of magnitude past every other item in this catalog and past anything
  the faucet stack pays out. The catalog's own comment carries this reasoning; the ladder test now
  spans both blocks as one ascending sequence, since the earned tier interrupts the id run but not
  the pricing.
- **A seventh sheet was rejected and is not in the roster.** Its three panels are boxed scenes — a
  tufted chair filling the frame and a brown desk under the figure's hands — rather than a figure on
  a black plate, so there is nothing for the border flood to remove: `key_panel` keeps the whole
  rectangle and the "cutout" is an opaque box. Two of its panels also touch with no gutter, so the
  band splits into 2 instead of 3 and the slicer refuses outright. Both symptoms are the same root
  cause, and no threshold fixes either — the chair's charcoal and the suit's charcoal are the same
  luma. The framing contract in `prepare-seat-art.py`'s docstring (black plate, head-to-hands,
  running off the bottom edge) is what a sheet has to satisfy; a sheet that doesn't needs
  re-rendering, not a looser key.

### Nine characters turned the wrong way, and the roster took real names (2026-08-21)
- Kayo: "some are facing the wrong way." `character13`-`character21` — every character that arrived
  through `slice-seat-sheet.py` — turn toward screen-RIGHT as the angle rises; `character1`-`character12`
  turn screen-LEFT, which is the convention `prepare-seat-art.py`'s docstring pins and the entire seat
  system assumes (`pickSeatArt` mirrors only for a seat on the dealer's left, so an un-mirrored plate
  has to look screen-left). Nine characters were therefore looking AWAY from the pot at every seat.
- Fixed by normalising the ART, not by branching the app: the 27 source plates in
  `art/seats/character13`-`21` were flipped horizontally and `prepare-seat-art.py` re-run (whole bucket
  per character, so a mirrored 0deg plate keeps hair part/watch consistent with its own 20/40). Verified
  the script is deterministic first — a no-op run before the flip rewrote nothing — so the rebuild's
  diff is exactly those nine characters, plus ~2px box-width shifts from the head-centre re-rounding.
  A per-character `facing` flag in `seat-art.generated.ts` was the alternative and was rejected: the
  script can't detect facing, so the flag would be hand-maintained and silently wrong for the next
  sheet, and it would teach the app two conventions to serve art that can just be flipped once.
- `slice-seat-sheet.py` gained `--mirror` (flips each panel AFTER slicing — mirroring the whole sheet
  would also reverse panel order and file 40deg's plate as 0deg) so the next wrong-turning sheet is
  normalised on the way in. Both scripts' docstrings now say which way to check and what it looks like.
- **No automated facing check exists, deliberately.** The obvious heuristic (torso/chair alpha centroid
  sitting to the right of the head centre on the widest plate) was measured across all 21 and comes out
  negative for `character3`, `character12` and `character16`, all of which are correct — it would fail
  three good characters to catch a bad one. Eyeball the widest panel instead: chair back on the right,
  profile looking left.
- Same pass, Kayo's second ask: **everyone at the table is named with a gamer tag now, bots included.**
  First read as "real names" and shipped that way for one round (The Hustler → Andre Cole); Kayo's
  correction was "real peoples gamer tags... simulate the bots rotating seats to having realistic gamer
  tags so it feels like theyre playing real people," with their own two handles as the reference. So:
  - `lib/game/engine.ts`'s `botProfiles` — the pool a seat actually shows — moved off single first
    names (Jax/Maya/Theo, which read as a cast of NPCs) onto handles: `jaxdidthat`, `maya_ontilt`,
    `riverrat_rj`, `slowroll_sam`. Renamed IN PLACE and then appended to, never reordered — identity
    indices are persisted on seats and every live table backfills bots from `position`, so moving an
    entry would swap the players at every table in flight. Pool grown 18 → 30 the same pass, so a
    rotating seat is less likely to hand back a tag the player just watched leave.
  - `initials` was deliberately left alone and is NOT the tag's first two letters (JX for
    `jaxdidthat`, RV for `riverrat_rj`). It is shorthand for the nickname inside the tag, which is
    what the avatar circle wants and what a player already associates with that seat.
  - `characterAvatarOffers` (`lib/cosmetics/catalog.ts`) is tags too, a SEPARATE list — `deewavy`,
    `malik_23`, `ttv_danpark`. Nothing maps a character to a bot: the catalog names a FACE for the
    store, the bot pool names who is in the chair, and a player wearing character7 still shows their
    own name. Tying the two axes was considered and left alone; the engine's own comment calls them
    deliberately separate and identity indices are persisted.
  - Blackjack's dealers stay Loki & Finn, real names (`lib/arcade/dealer.test.ts` pins the shape).
    They're Kayo's dogs dealing the game — staff, not someone you're playing against — and a handle
    over the dealer's chair would make them one more seat.
  - Four tests in `engine.test.ts` pin the register: tag shape, ≤14 chars (a human's name is capped at
    18 and shares the nameplate; the plate crowds before that on a phone), no duplicates, and a MIX of
    shapes. That last one is the point of the whole ask — one visible formula across every entry
    ("name_word", 30 times) hands the generated feel straight back however good each tag is.
- Verified: `npx vitest run` 2334/2334, clean lint, clean production build, `tsc` clean apart from the
  pre-existing `safe-area.spec.ts` failure.

### Rewarded-ad faucet (2026-08-11)
- Wait moved 30s→5min (`REWARDED_AD_DURATION_MS`), grant TTL 10→20min to compensate. New direct
  "Free Gold" row in the lobby player menu (same eligibility threshold as the existing busted-hand
  trigger, registered accounts only). Adsterra zone is `pl30614359` now (was `...360`).

### Repo-quality pass (2026-08-06)
- Deleted the dead `lib/server/table-manager/` worker (2,563 lines, never had an entry point) and
  `cash-game-session-store.ts` — the DB table/migration stay (migrations are append-only).
  `STAKES_TIERS` is a single readonly tuple now instead of three hand-written copies that had already
  drifted.

### Money-ordering rules (every staked game — Blackjack, PvP duels, Cribbage, Ante Up)
1. Debit the stake before the thing it pays for exists; a failed creation refunds.
2. Credit a payout only after the version-guarded settlement write is confirmed.
3. Settlement is always a single credit (`stake + net`), never a second debit.
4. (PvP only) Escrow releases exactly once, via a status-guarded write returning the row at most once.
Each service restates these at the top of its own file on purpose — breaking one is a silent money
bug. `pvp-match-service.ts` centralizes them for every duel and `cribbage-service.ts` generalizes the
same shape to N players; Blackjack keeps an independent copy deliberately (live, moving real Gold,
not worth restacking). `lib/server/casino-round-service.ts` used to centralize this for four other
casino games (Roulette/Video Poker/Coin Flip/Baccarat) — deleted 2026-08-20 along with those games
and Hi-Lo (see that date's entry); Blackjack was never migrated onto it, so nothing else depended on
it once its four real callers were gone. Version columns double as the settlement idempotency key —
a lost race must return null, and null must never pay out (this is what makes a double-clicked
action, a retry, or two tabs settle once).

### Bot / economy behavior
- Bots leave/return voluntarily between hands (`BOT_VOLUNTARY_LEAVE_CHANCE`, never below 3 funded
  seats; `TABLE_FUNDED_FLOOR` = 6) — forced to 0 whenever `VITEST` is set regardless of env override,
  since hundreds of tests reach this indirectly through `setupHand`.
- Bot personality (`MANIAC`/`ROCK`/`CALLING_STATION`, 35/45/20 weighted) is independent of bot
  identity and re-rolled on every reseat; `trashContinueChance` per personality is what actually
  varies preflop looseness (VPIP ~45%/26%/64%).
- `creditGold`/`spendGold` go through row-locking RPCs (`credit_gold`, `spend_gold`), never a plain
  read-then-write — `adjustGold` is a deliberate exception, documented as admin-only for that reason.
- **There is no purchase path to Gold any more (2026-08-13).** Buy-Gold was removed; see "Voluntary
  support" below. Level rewards (every 5th level) and daily-streak multipliers (capped ×2.5 at 7
  days) are still deliberately small, but the *reason* changed: they used to be bounded against a
  Stripe sale price (protect revenue, ~1% of turnover vs. the arcade's ~3% edge), and that premise is
  gone. They're kept small now for progression pacing — a reward that felt free would stop feeling
  like an achievement — not to protect a sale. `[[project_stackchips_gold_economy]]`'s
  revenue-protection framing is superseded, not still binding; don't cite it as the reason for a
  faucet number going forward.
- The only way back into Blackjack/duels/poker after busting to 0 Gold is the faucet stack:
  `claimBackstopGold` (`lib/profile/backstop.ts`, 1,000 Gold, open to guests, no wait on a first
  claim — only a 12h cooldown on repeat claims), the daily grant (`DAILY_GOLD_GRANT` × streak
  multiplier, independent UTC-day clock), and rewarded ads for registered players
  (`REWARDED_AD_GOLD` × up to 6/day). All three are already sized off `TIER_CONFIG[CHEAPEST_TIER]
  .minBuyIn` (1,000, the floor for every staked surface in the app), not off a Stripe price — removing
  Buy-Gold didn't touch any of their numbers. Verified 2026-08-13 when Buy-Gold was removed: worst
  case for anyone is bounded by the shorter of "12h since the last backstop claim" or "next UTC day,"
  never indefinite.

### Known open items / gaps
- M17 (chip cosmetics) is deliberately parked until the 3D sim is finished.
- Challenging a specific opponent shipped for table seats (`components/table/challenge-seat-control.tsx`,
  PR #111, 2026-08-19) — a seated player can now be challenged to a duel directly. Picking a friend to
  invite to an empty seat (M16 table invites) is still open; that's a different flow (no seated
  opponent to challenge).
- PvP duel sync is a 2s poll, not Realtime.
- Blackjack's Supabase persistence branch has never been exercised by a real hand in production
  (only type-checked, plus the memory-mode branch under test).
- `multiplayer.spec.ts`'s six-player test and two `safe-area.spec.ts` table tests fail identically at
  a pristine HEAD worktree, unrelated to recent work — reconfirm against a fresh worktree before
  treating a red run here as a regression (see `[[reference_stackchips_e2e_traps]]`).

### Public-launch readiness pass (2026-08-19)
Play-money platform: Gold has no cash value and nothing here is real-money wagering. "Make money"
means Gold purchases + voluntary support (`lib/legal/documents.ts`'s existing disclosures), both
already live Stripe integrations — this pass is production/scale hardening, not a new business model.

**Correction to `docs/launch-checklist.md`'s own text**: it still reads "session identity is an
HttpOnly random cookie rather than a verified email/social login," and an earlier pass in this file
repeated that as the single biggest gap. Both are stale. Real Supabase Auth already ships — email/
password (`signInWithEmail`/`signUpWithEmail` in `components/poker-app.tsx`) and Google OAuth
(`app/auth/callback/route.ts`), with cross-device account recovery: `lib/server/link-account.ts`'s
`linkAuthenticatedUser` restores an existing profile by Supabase user id on a new device, or links a
guest's current Gold/avatar to a newly-created account. Checked by reading the actual code, not the
doc, after almost repeating the doc's stale claim into this file a second time — verify an
auth/session claim against `lib/server/link-account.ts` and `components/poker-app.tsx`, not
`docs/launch-checklist.md`, which needs its own edit to stop asserting this.

Real remaining gaps, in order:
- **Rate limiting is genuinely process-local** (`lib/server/rate-limit.ts`, an in-memory Map) and is
  called from 77 different API routes via `enforceRateLimit`/`checkRateLimit`, most of them
  money-adjacent (Stripe, Gold, cosmetics purchases). A correct fix means making that function async
  and backing it with a shared store (Postgres-RPC or Upstash Redis) — a real, valuable change, but a
  77-call-site refactor across every payment-adjacent route is exactly the kind of change that needs
  a human reviewing it live, not one running unsupervised overnight. Deliberately left undone this
  pass; next concrete step if picked up: a `rate_limit_buckets` table + row-locked RPC (no new
  external credential needed, matches every other money RPC's shape), then a scripted `await` add
  across the 77 call sites, verified by the existing test suite before merging.
- Realtime still runs on one small `game_signals` channel, capped by the checklist itself at ~3,000
  concurrent subscribers before a migration to Realtime Broadcast is needed — a real scale trigger,
  not an immediate blocker.
- Supabase Auth's "leaked password protection" advisor (`auth_leaked_password_protection`, WARN) is
  off. It matters now that real password sign-up exists — it didn't when the checklist was written.
  No MCP tool exposes this; toggle it at Dashboard → Authentication → Policies → Password Security.
- The checklist's 15-minute live multi-browser production soak after any gameplay/persistence change
  should be reconfirmed given how much shipped recently (cribbage, achievements, mid-hand rebuy).

Shipped this pass (branch `feat/production-launch-readiness`): OG/Twitter card metadata + a generated
`opengraph-image.tsx` (there was no share-link preview at all before — a shared stackchips.app link
fell back to a bare text card), `robots.ts`/`sitemap.ts`, and `middleware.ts`'s exclusion list
extended to cover them (same "no session to refresh" reasoning as the existing legal/about/help
exclusions). A full marketing landing page was deliberately **not** built — Kayo explicitly stripped
`app/page.tsx` down to the bare sign-in form on 2026-08-09 ("less chrome, less copy"), and reversing
that is a real product call, not an inference to make unsupervised; flagged for Kayo's decision, not
decided here. Also applied `20260819090000_missing_fk_indexes.sql` (six missing indexes from the
Supabase performance advisor; `cash_game_sessions`' own finding was skipped — that table's store was
already deleted in the 2026-08-06 repo-quality pass).

### 3D table: scrap under consideration, not decided (2026-08-19)
Kayo is weighing dropping the WebGL 3D table outright — "too much work, don't want to waste time on
it" — floated, not committed. If a future pass sees `components/game3d`/`lib/game3d` deleted and the
`webgl_3d` renderer option gone, treat it as decided; otherwise this is still open. Measured same day:
`components/game3d/` + `lib/game3d/` is 101 files / ~18,400 lines, and 23 e2e specs touch the 3D room.
That matches the churn already logged above (eight geometry-rebuild rounds, arm-IK, the hand/finger
rig, the nameplate collision fix, a camera that structurally never sees a horizon, a meshopt pass, an
abandoned local character-gen effort) for one of three table renderers. The 2.5D racetrack table is
the one actually converging with real polish and already shares the seat-art/avatar system with the
rest of the app; `canvas_2d` stays as the no-WebGL fallback regardless of what happens to 3D, so
removing it wouldn't remove a fallback path. If this lands, M17 above (parked "until the 3D sim is
finished") needs Kayo's explicit re-decision, not a silent default.

Update this section when scope changes; keep `CLAUDE.md` synchronized.
