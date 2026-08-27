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
`lib/scene/CLAUDE.md` (2D table), `lib/scene/chips/CLAUDE.md` (chip system), `app/styles/CLAUDE.md`
(styling contract), and the `deploy-checklist` skill (pre-merge/deploy).

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

### Cribbage sync moved off its fixed 2s poll onto Realtime, same pattern as duels (2026-08-26)
Follow-up to the PvP duel Realtime migration (branch `feat/pvp-duel-realtime-sync`, itself not yet
merged) — Kayo asked for cribbage on the identical pattern, named `crib`. Two channels, not one:
`crib:lobby`, a single global channel every browser on the open-table join screen shares (GET
`/api/cribbage` lists open tables across every stake with no per-viewer filter, unlike a duel's own
challenge list, so there's no narrower key to give it), and `crib:<tableId>` once seated. Both fired by
a new `broadcast_crib_signal()` trigger (new migration, branch `feat/crib-realtime-sync`) on writes to
`cribbage_tables` **and** `cribbage_table_players` — the latter matters because `claim_cribbage_seat()`
(joining) only ever writes the seat table, never `cribbage_tables` itself, so a trigger on just the
table would silently miss every join and the open list's seated-count would never update. Real bug
caught writing the trigger: `NEW`/`OLD` are unassigned records (not null-valued rows) for the
row-trigger operation that doesn't apply, so a naive `coalesce(new.table_id, old.table_id)` on the
DELETE-only-for-leaves table raises "record is not assigned yet" — fixed by branching on `TG_OP`
explicitly instead. Same shell changes as the duel branch: keyed on `tableId` (a primitive) rather than
the table object so a move's version bump doesn't tear down and resubscribe the channel, a 15s backup
poll alongside the channel (no other seated human's turn-clock tick to notice a stale socket the way
poker has), fallback to the old fixed poll when Supabase isn't configured, and the same 429/Retry-After
backoff duel-shell.tsx carries. **Migration not yet applied** — verify with
`supabase migration list --linked` before assuming it's live; see
`[[reference_stackchips_migrations_not_auto_applied]]`.
- History below is a dense changelog, not the discovery narrative — one paragraph per pass covering
  what shipped and what's still load-bearing or still open. Full reasoning for any decision is
  recoverable from `git log`/PRs on the branch each entry names. Every pass listed was verified with
  the full `npx vitest run` + `npm run lint` + `npm run build` (`tsc` clean) before landing; recurring
  pre-existing failures are `safe-area.spec.ts` and (until fixed 2026-08-26) two
  `multiplayer.spec.ts`/`table-scene.spec.ts` reds — see Known open items. This file periodically gets
  compressed like this to stay under budget (2026-08-26 pass cut it ~101KB → current size) — when
  redoing this, cut narrative/verification boilerplate, never a fact or an open gap.

### Seat-art roster grown to character29; the 2026-08-25 renumbering wasn't recorded here (2026-08-26)
Four new characters added (`character26`-`29`, all rare-tier, continuing the Gold ladder's constant
second-difference sequence — delta grows by 10,000 each rung — up to 3,530,000). Also surfacing a gap:
the roster was renumbered from a gappy `character13-41` set down to a clean `character1-25` on
2026-08-25 (same day as the "roster to 41" entry below), closing a pricing discontinuity the
`character29`/`31`-`34` deletions had left — but that renumbering was never logged as its own entry in
this file, only in `catalog.ts`'s own comment block. **Any reference below this point to
`character##` above 25 refers to the old, now-dead numbering** — resolve a specific character by name,
not by id, when reading older entries. The live top of the roster is `character29`, not `character41`.

### Sit & Go: a 6-max poker tournament, StackChips' first (2026-08-26)
Single-table Sit & Go, not a scheduled multi-table event — every staked PvP format here is deliberately
human-only, and a 6-max table just waits for real registrants rather than risking an MTT field that
never fills. Entry fee and starting stack both equal an existing `STAKES_TIERS` tier's buy-in; blinds
escalate on a hand-count schedule at turbo pace; winner-take-all. Reuses the poker engine directly
(`GameState.tournament`) rather than forking it — busting throws on rebuy, forfeits the seat instead of
handing it to a bot, and an idle tournament seat auto-folds forever rather than ever going to bot fill.
A `/code-review` pass caught two severe bugs the test suite structurally couldn't (memory-mode tests
never exercise a real SQL CHECK constraint): both new CHECK constraints were written before the RPCs
that violate them and made every deal/cancel attempt hard-`FALSE` against a real Postgres — fixed by
narrowing both to what's actually invariant. Also fixed: an eliminated player's table-row was never
cleaned up, so they read as "still registered" and got bounced back into the game they'd already lost.
A follow-up optimize pass fixed a redundant double-profile-resolve on the open-table lobby poll and
serialized-should-be-parallel head-to-head writes on settlement (cribbage's route has the identical
redundant-resolve shape, deliberately left alone as out of scope). PR merged into main alongside the
3D-table deletion below; migration unapplied — see `[[reference_stackchips_migrations_not_auto_applied]]`.

### The WebGL 3D table is deleted outright (2026-08-26)
Resolves the "scrap under consideration" question that had been open since 2026-08-19 — Kayo's call,
stated directly: "kill it... scrap all of it," with one carve-out: keep the 2D seat-art roster
(`character1`-`41`, never 3D-room code) exactly as-is. Nothing was left half-copied in the live tree —
the whole subsystem was snapshotted under a pushed tag, `archive/webgl-3d-table`, before deletion;
recover any file from there rather than re-deriving it. Deleted: `lib/game3d/` (63 files),
`components/game3d/` (36 files), `app/game3d/`, the 3D bridge component, every GLB asset, four
asset-pipeline scripts, and the `three`/`@react-three/*` npm dependencies — plus a second, fully
separate 3D-only cosmetics slot (`CHARACTERS_3D`, `character3DCosmetics`, `avatar3d` on
`EquippedCosmetics`) that existed only for the 3D room's own characters. Two files under a
`game3d`-named path were moved rather than deleted because the racetrack table depends on them too:
`table-shape.ts` (stadium-curve geometry math) → `lib/scene/`, `table-loading-splash.tsx` →
`components/table/`. **M17 (chip cosmetics), parked "until the 3D sim is finished," needs Kayo's own
re-decision now that there is no 3D sim left to finish** — not resolved by this deletion.

### Classic portrait table deleted outright; racetrack is the only table (2026-08-25)
Kayo's call: the 2.5D racetrack is the sole table, the 3D room stays around disabled for later,
"players will just have to turn their phones." Deletes the dead `canvas_2d` code itself (it was
already unselectable since 2026-08-17): `table-scene.tsx`, `projection.ts`, `felt-art.ts`, the classic
dev chip bench, `near-seat-bet.spec.ts`. `TableRenderer` narrows to `"webgl_3d" | "racetrack_2d5"`;
`ActionBar`'s variant renamed `"classic"|"3d"` → `"flat"|"3d"`. Trimmed rather than deleted where
classic-looking code is still load-bearing: `table-geometry.ts` (racetrack's own fallback + the 3D
room's DOM seat cutouts), `seat-ring.ts` (kept `seatAngle` only) — surfaced a real dangling-default
bug in `ChipScene`'s constructor, fixed. `12-responsive.css`'s portrait media query was deliberately
NOT split apart — it interleaves dead classic-table CSS with live lobby portrait rules and untangling
it wasn't worth the regression risk for CSS that already has zero effect. `lib/scene/CLAUDE.md`
rewritten (it still described pre-racetrack reality).

### Leaderboards are PvP-only; Memory Match's board removed (2026-08-24)
Rule, restated three times by Kayo: every PvP game gets a leaderboard, poker keeps its own (hands
won/biggest pot), Ante Up SOLO games get none — per-difficulty boards rejected as "too much" screen
cost. Memory Match predated the rule; fixed to match via migration: `recordMetricResult`/
`average_metric`/`lower_better` and the `metric_sum`/`metric_count` scoring machinery are deleted
entirely (the columns stay, migrations are append-only); `global_leaderboard_entries()`'s SQL no
longer special-cases `'memory-match'`. `isHeadToHeadGame` is now registry membership, not
`kind === "win_loss_record"`. Old `game_leaderboard_stats` rows for memory-match are left in place,
inert.

### Ante Up: Minesweeper, first of a 12-game solo+PvP expansion (2026-08-24)
Kayo's ask: 10 more solo games + PvP versions, one game at a time, fully built before the next starts
— see `[[project_stackchips_ante_up_catalog_expansion]]`. Minesweeper shipped: every board is
guaranteed solvable with no forced guess (mines placed after the first reveal, board re-rolled through
a logic solver) — this is why there's a per-tier clock, since a no-guess board has no natural risk
otherwise. A mine and a resignation both settle as attempt status `lost` (don't add a `resigned`
status — the DB CHECK constraint doesn't have one); the UI tells them apart via `board.explodedAt`. No
leaderboard, no migration needed (the `game` column on `ante_up_attempts` is already free-form text) —
same rule applies to the remaining nine games.

### Web Push re-engagement notifications (2026-08-24)
Built from scratch (no push infra existed): `push_subscriptions` table, VAPID keys (real pair
generated and handed to Kayo directly, not committed — nothing works until they're in env),
`lib/push/copy.ts`'s rotating PlayPokerGO-style copy pool. v1 trigger is only "come claim daily Gold,"
asked as part of account creation (a real user gesture), not a later prompt. Daily cron fires at one
fixed UTC hour with no per-player timezone — a known gap, not a fix. See
`[[project_stackchips_push_notifications]]`.

### Seat-art roster to 41; first two-angle characters; duplicate bot faces fixed (2026-08-25)
`character36`-`41` added (rare tier, 0/20deg only per Kayo's call — no 40deg plate for these).
`slice-seat-sheet.py` gained plate-polarity auto-detection and automatic no-gutter panel splitting.
Real bug found and fixed: bots could duplicate a seat-art face table-wide because uniqueness was only
enforced on tag/avatarPreset, not the resolved seat-art character — added `takenFaces` to
`pickBotIdentity`'s filter. Don't fix this by sizing the bot tag pool to the roster — they're meant to
grow independently.

### Seat-art roster to 35; character22-31 caught facing the wrong way (2026-08-22)
`character32`-`35` added. Also caught: `character22`-`31` (added the day before) were facing
screen-right, the wrong direction per `seat-art.ts`'s un-mirrored-plate contract — fixed by flipping
the 9 already-cut plates and rebuilding, not by branching the app. There is still no automated facing
check (a torso/centroid heuristic false-positived on 3 known-good characters) — verify a new batch's
widest panel against `character16`/`17` by eye, every time; see
`[[reference_stackchips_seat_sheet_slicing]]`.

### Ante Up split: Sudoku/Memory unlimited, Word Stack/Connections keep the daily gate (2026-08-21)
Same-day correction to the entry below: Kayo wanted a wager chosen before the game starts, with no
more daily limits *except* on Word Stack/Connections. Sudoku and Memory Match lost their daily gate
entirely — `/games/sudoku` and `/games/memory` now are what `/games/ante-up-sudoku|memory` already
were (unlimited wager-or-free replay). Word Stack/Connections keep exactly one gated attempt/day, but
the wager choice now gates *opening* that attempt instead of unlocking a second unlimited sibling —
their old separately-repeatable Ante Up routes are deleted. A wager replaces (does not stack with) the
free path's daily completion bonus.

### Ante Up unified: one section, four brain games (2026-08-21)
Word Stack, Connections, Sudoku, Memory Match merged into one "Ante Up" section (all `kind: "wager"`)
— first play/day is the shared daily puzzle (pays a skill-scored bonus via `daily-puzzle-bonus.ts`,
replacing the old flat "Complete one brain game" mission, which is disabled via migration not deleted),
then unlimited free replay or repeatable Gold wagers on fresh rounds. `ante_up_attempts` generalized to
all four games (added a `game` column; `tier` replaces Sudoku-only `difficulty`). Memory Match had no
loss condition to hang a wager on, so `ANTE_UP_MEMORY_MAX_TURNS = 20` invents a turn cap for wagered
play only. Superseded same-day by the entry above for Word Stack/Connections' daily gate.

### One dealer on the 2.5D table: Claira (2026-08-21)
Kayo's girlfriend, replacing the 3-dealer rotation outright (not reduced to a roster of one —
`dealerForHand`/`HANDS_PER_DOWN`/`DEALER_IDS` deleted). Blackjack's dealers (Loki & Finn, the dogs) are
untouched — two different dealer identities on two surfaces, a deliberate split. `prepare-dealer.py`
now auto-detects plate polarity and never upscales past the source image's own resolution. The name
badge in the shipped art reads "ELENA" — flagged for Kayo, nothing in code keys off it.

### Seat-art roster to 15 then 21; sheets are now sliced by script (2026-08-21)
Kayo switched to supplying one labelled 3-up JPEG turnaround sheet per character instead of pre-cropped
files; `slice-seat-sheet.py` cuts and keys them (floods at luma<=6, not `prepare-seat-art.py`'s <=1,
since JPEG ringing defeats the stricter threshold). `character13`-15 shipped as a new EARNED tier
(`price: null`, unlock at 250/750/1,500 lifetime hands won) — bots are excluded from this tier.
`character16`-21 followed on the Gold ladder instead of growing the earned tier (Kayo: keep the earned
tier at exactly 3 rungs). One supplied sheet was rejected outright — boxed-scene panels with no plate
to key against.

### Nine characters were facing the wrong way; the cast now uses gamer tags (2026-08-21)
`character13`-21 all turned screen-right, the wrong convention; fixed by flipping the source art (not
branching the code) and adding `slice-seat-sheet.py --mirror` for future sheets. Separately, Kayo:
every seat (bots included) should read like a real player's gamer tag now, not a first name —
`botProfiles` renamed in place (never reordered — identity indices are persisted per seat) and grown
18→30 entries. `characterAvatarOffers` (the store catalog) uses tags too but is a deliberately
separate list from the bot pool — nothing maps a store character to a bot identity. Blackjack's
dealers stay real names (they're staff, not opponents). See
`[[feedback_stackchips_gamer_tag_register]]`.

### Friends leaderboard: a head-to-head record per opponent (2026-08-20)
New `head_to_head_records` (profile, opponent, game), written in mirrored pairs by one RPC so a "me
vs. them" read never needs to flip anyone's win into a loss. Fed by the same settlement call that
writes the world leaderboard — no second call site. Migration backfills history from existing
`pvp_matches`/`cribbage_tables`. Membership is `isHeadToHeadGame`; poker and Memory Match are never
written (no single named opponent). See `[[project_stackchips_friends_head_to_head]]`.

### The five retired casino games are deleted outright, not just blocked (2026-08-20)
Roulette/Video Poker/Coin Flip/Baccarat/Hi-Lo (retired 2026-08-12, code left mounted) fully deleted per
Kayo's explicit follow-up — engines, services, routes, components, CSS (38 files).
`casino-round-service.ts` (their shared wallet path) went too, confirmed dead by grepping importers
first. `lib/arcade/retired.ts`'s guard mechanism stays as the documented way to retire a *future* game
without a same-day deletion — an empty `RETIRED_ARCADE_GAMES = []` is its normal resting state, don't
assume it's unused-and-safe-to-delete.

### Daily Wordle renamed to Word Stack (2026-08-19)
Trademark cleanup — every identifier/route/CSS class renamed (`daily-word-stack`,
`/games/word-stack`). Tile colors: correct/present stayed green/gold, `absent` recolored from
greenish-grey to blue-grey. Answer pool grown 751→1,119, mechanically verified against the existing
guess dictionary. See `[[project_stackchips_word_stack_rebrand]]`.

### Public-launch readiness pass (2026-08-19)
Corrected a stale claim in `docs/launch-checklist.md` (and repeated once in this file before being
caught): real Supabase Auth with cross-device account recovery already ships — verify auth/session
claims against `lib/server/link-account.ts`, not that doc. Real remaining gaps, in priority order:
rate limiting is process-local (in-memory Map, called from 77 routes) and needs a shared-store
refactor — deliberately left undone, it's a large payment-adjacent change that wants live review, not
an unsupervised pass; Realtime is capped at ~3,000 concurrent subscribers before needing Broadcast;
Supabase's "leaked password protection" advisor is off and now matters (toggle in Dashboard, no MCP
tool for it). Added OG/Twitter card metadata, `robots.ts`/`sitemap.ts`. A full marketing landing page
was deliberately not built — reversing the bare-sign-in-form is Kayo's call, not an inference. See
`[[project_stackchips_launch_readiness_assessment]]`.

### Cribbage: a 3-4 player free-for-all table (2026-08-18)
New parallel N-seat contract (`lib/cribbage/`) rather than a fifth 2-player duel — `pvp_matches` is
hardwired to exactly two seats at every layer. Full standard rules (deal 5, crib, pegging to 31, race
to 121); counting has no player decisions so it resolves automatically the instant pegging empties
every hand. Human-only, no bot fill (a bot winning a share of a real Gold pot was judged worse than a
table someone waits on). Resigning ends the whole table immediately, pot to the higher score — there's
no well-defined "the rest keep playing" the way a poker fold has.

### The avatar collection and the seat-art roster became one system (2026-08-17)
The 11-character seat-art roster replaced the old 20-entry illustrated avatar catalog outright, art
and catalog both — one id space now sells/equips a character, supplies every avatar image app-wide,
and is what's drawn at a seated opponent's own seat (`seat.avatarCosmetic` read directly instead of
always hashing). `botAvatarFor` repointed to the character-only cosmetic list so a bot can't land a
3D-only id in its 2D seat. An earlier same-day attempt at this got fully reverted mid-conversation for
landing uncommitted and half-finished — this is the real, complete version, confirmed with Kayo piece
by piece. See `[[project_stackchips_illustrated_avatars_retired]]`.

### Site footer + info pages (2026-08-16)
Kayo wanted the lobby to feel like "a genuine web platform." Added a lobby-only footer plus `/about`,
`/help`, `/how-to-play`, `/rewards` — the five existing `/legal/*` pages had nothing anywhere linking
to them. `/rewards` is wayfinding only (every "claim" link routes back to where the action already
lives) rather than a second claim surface, so money-ordering rules can't be duplicated wrong in a
second place. See `[[project_stackchips_site_footer_info_pages]]`.

### Economy/retention redesign, milestone 1: missions (2026-08-14)
Kayo's directive: redesign the economy around progression/collection/achievement, not monetization.
Missions shipped first (auto-credited, no claim button) via `lib/missions/events.ts` fanning a domain
event out to every mission it feeds. Milestone 2 (achievements/badges) has since shipped too. See
`[[project_stackchips_economy_retention_redesign]]`.

### Voluntary support payments replace Buy-Gold (2026-08-13)
The Gold storefront was removed; every support tier (one-time or monthly Stripe) grants nothing — no
Gold, no gameplay effect, matching the support disclosure exactly. Don't add a Gold/gameplay reward to
a tier without updating that disclosure first. Gold purchases were later reinstated (see
`[[project_stackchips_gold_purchase_reinstated]]`) — support payments run alongside them, not instead.

### The 2.5D racetrack table (2026-08-13)
Third table renderer, camera-led where the (now-deleted) classic table was CSS-led — `fitCamera`
solves a real perspective camera and the DOM follows anchors the scene projects, rather than a
hand-tuned CSS ellipse. Landscape-only by design (a 2:1 table has no usable portrait framing) — falls
back quietly, never blocks play. See `[[project_stackchips_racetrack_table_rebuild]]` for the full
geometry/dealer/board history.

### PvP duels replace the retired house-gambling games; misc fixes (2026-08-12)
Roulette/Video Poker/Coin Flip/Baccarat/Hi-Lo retired (server-guarded, not just delinked);
Chess/Checkers/Trivia Showdown/Word Race added as 1v1 winner-take-all duels with balance-conservation
as the safety invariant (no house edge). Every duel engine's `tick()` must return null when nothing
changed or it livelocks the optimistic-concurrency poll. Puzzle-answer banks must be `server-only` —
Word Race's wasn't at first and leaked its answer bank into the client bundle. Also this pass: three
distinct click sounds replacing one generic cue, three remount bugs fixed from `/games/*` routes
unmounting the whole app, and 3D-room avatar-load-gate/gesture-playback fixes.

### Rewarded-ad faucet (2026-08-11)
Wait moved 30s→5min, grant TTL 10→20min to compensate. Adsterra zone rotated.

### Repo-quality pass (2026-08-06)
Deleted the dead `lib/server/table-manager/` worker (2,563 lines, no entry point) and
`cash-game-session-store.ts`. `STAKES_TIERS` collapsed from three drifted hand-written copies to one
tuple.

### Money-ordering rules (every staked game — Blackjack, PvP duels, Cribbage, Ante Up)
1. Debit the stake before the thing it pays for exists; a failed creation refunds.
2. Credit a payout only after the version-guarded settlement write is confirmed.
3. Settlement is always a single credit (`stake + net`), never a second debit.
4. (PvP only) Escrow releases exactly once, via a status-guarded write returning the row at most once.
Each service restates these at the top of its own file on purpose — breaking one is a silent money
bug. `pvp-match-service.ts` centralizes them for every duel and `cribbage-service.ts` generalizes the
same shape to N players; Blackjack keeps an independent copy deliberately (live, moving real Gold, not
worth restacking). Version columns double as the settlement idempotency key — a lost race must return
null, and null must never pay out (this is what makes a double-clicked action, a retry, or two tabs
settle once).

### Bot / economy behavior
- Bots leave/return voluntarily between hands (`BOT_VOLUNTARY_LEAVE_CHANCE`, never below 3 funded
  seats; `TABLE_FUNDED_FLOOR` = 6) — forced to 0 whenever `VITEST` is set regardless of env override,
  since hundreds of tests reach this indirectly through `setupHand`.
- Bot personality (`MANIAC`/`ROCK`/`CALLING_STATION`, 35/45/20 weighted) is independent of bot
  identity and re-rolled on every reseat; `trashContinueChance` per personality is what actually
  varies preflop looseness (VPIP ~45%/26%/64%).
- `creditGold`/`spendGold` go through row-locking RPCs (`credit_gold`, `spend_gold`), never a plain
  read-then-write — `adjustGold` is a deliberate exception, documented as admin-only for that reason.
- Gold purchases exist again (reinstated after Buy-Gold's 2026-08-13 removal — see
  `[[project_stackchips_gold_purchase_reinstated]]`). Level rewards (every 5th level) and
  daily-streak multipliers (capped ×2.5 at 7 days) are kept small for progression pacing, not to
  protect a sale price — `[[project_stackchips_gold_economy]]`'s revenue-protection framing is
  superseded, don't cite it for a faucet number going forward.
- The faucet stack for reaching 0 Gold: `claimBackstopGold` (1,000 Gold, open to guests, 12h cooldown
  on repeat claims), the daily grant (`DAILY_GOLD_GRANT` × streak multiplier), and rewarded ads for
  registered players (`REWARDED_AD_GOLD` × up to 6/day). All three are sized off
  `TIER_CONFIG[CHEAPEST_TIER].minBuyIn` (1,000, the floor for every staked surface), not off a Stripe
  price.

### Known open items / gaps
- M17 (chip cosmetics) was parked until the 3D sim was finished — the 3D table is now deleted (see
  above), so this needs Kayo's own re-decision rather than staying silently parked.
- Challenging a specific opponent shipped for table seats (PR #111, 2026-08-19). Picking a friend to
  invite to an empty seat (M16 table invites) is still open — a different flow, no seated opponent to
  challenge.
- PvP duel sync is a 2s poll, not Realtime.
- Blackjack's Supabase persistence branch has never been exercised by a real hand in production (only
  type-checked, plus the memory-mode branch under test).
- `multiplayer.spec.ts`'s six-player test and two `safe-area.spec.ts` table tests fail identically at
  a pristine HEAD worktree, unrelated to recent work — reconfirm against a fresh worktree before
  treating a red run here as a regression (see `[[reference_stackchips_e2e_traps]]`).
- Several migrations named in the history above may or may not be applied to production yet — merging
  a PR ships code only. Verify current DB state by querying, never by trusting a historical note here
  or matching version stamps; see `[[reference_stackchips_migrations_not_auto_applied]]`.
- Rate limiting is process-local and needs a shared-store refactor across 77 call sites (see the
  2026-08-19 public-launch-readiness entry above) — a real gap, deliberately left for a live-reviewed
  pass rather than done unsupervised.

Update this section when scope changes; keep `CLAUDE.md` synchronized.
