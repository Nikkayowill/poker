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
  the art puts a hand and a card on the table and painting it under removes exactly that.
  z-index 3: above the canvas, below every seat. There is a **rotation** of dealers, one
  at a time: `dealerForHand(tableId, handNumber)` in `lib/scene/dealer-roster.ts`, pure
  over two server-authoritative fields so every client at a table agrees without anything
  crossing the wire, and changing only between hands (`HANDS_PER_DOWN`).
- **Adding a dealer must never need a number.** Drop a plate in `art/dealers/<id>.png`,
  run `scripts/prepare-dealers.py`; it keys, normalises and regenerates
  `public/table2d5/dealers/*.webp` plus `lib/scene/dealer-art.generated.ts`. Normalising
  is what makes one slot serve everybody: each plate is scaled so its crown-to-hands
  height fills a shared box and centred on the alpha-weighted middle of its head band, so
  the app holds ONE placement (`DEALER_SLOT`) instead of per-dealer landmarks. The plate
  must be framed head-to-hands running off the bottom edge — that framing IS the contract,
  and a per-dealer offset appearing in the roster means a plate is wrong, not the code.
  The shared box is recomputed across the whole bucket per run, so every file is rewritten.
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
