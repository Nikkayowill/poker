# StackChips — Claude Context

## Project

StackChips (`stackchips.app`) is a Next.js 16/React 19/strict TypeScript six-max Hold'em app. The server is authoritative. Supabase supplies persistence, Realtime, Auth linkage, and Storage; absent env vars, stores use memory.

## System map

`components -> app/api -> lib/game -> lib/server -> memory | Supabase`

- `app/`: App Router pages/API; `app/page.tsx` mounts `components/poker-app.tsx`.
- `components/`: client state plus lobby, table, profile, store, admin UI.
- `lib/game/`: pure engine/types/evaluator/timing/snapshot redaction.
- `lib/server/`: game/profile/economy/session/admin persistence.
- `lib/supabase/`: shared browser client and SSR helpers.
- `supabase/migrations/`: imperative schema, RLS, RPCs, Realtime.
- `app/styles/`: numbered cascade; `app/globals.css` fixes load order.
- Tests: colocated Vitest units; `tests/e2e/` Playwright.

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

### Rewarded-ad faucet (2026-08-11)
- Wait moved 30s→5min (`REWARDED_AD_DURATION_MS`), grant TTL 10→20min to compensate. New direct
  "Free Gold" row in the lobby player menu (same eligibility threshold as the existing busted-hand
  trigger, registered accounts only). Adsterra zone is `pl30614359` now (was `...360`).

### Repo-quality pass (2026-08-06)
- Deleted the dead `lib/server/table-manager/` worker (2,563 lines, never had an entry point) and
  `cash-game-session-store.ts` — the DB table/migration stay (migrations are append-only).
  `STAKES_TIERS` is a single readonly tuple now instead of three hand-written copies that had already
  drifted.

### Money-ordering rules (every staked game — Blackjack, Hi-Lo, PvP duels, the casino-round games)
1. Debit the stake before the thing it pays for exists; a failed creation refunds.
2. Credit a payout only after the version-guarded settlement write is confirmed.
3. Settlement is always a single credit (`stake + net`), never a second debit.
4. (PvP only) Escrow releases exactly once, via a status-guarded write returning the row at most once.
Each service restates these at the top of its own file on purpose — breaking one is a silent money
bug. `lib/server/casino-round-service.ts` centralizes them for the newer casino games; Blackjack and
Hi-Lo keep independent copies deliberately (live, moving real Gold, not worth restacking unproven).
Version columns double as the settlement idempotency key — a lost race must return null, and null
must never pay out (this is what makes a double-clicked action, a retry, or two tabs settle once).

### Deploy / migration checklist
Learned the expensive way: `credit_gold`'s calling code shipped to production before its migration
was applied, so every credit threw and was silently swallowed by a `.catch()` — a day of cash-outs
and buy-in refunds paid nothing.
- A migration and the code that calls it are one change; ship together. Before merging, run
  `supabase migration list --linked` and confirm the migration is on the remote.
- `main` is Vercel's production branch, not any feature branch — pushing elsewhere only produces a
  Preview deploy. Verify a real deploy via `gh api repos/Nikkayowill/poker/deployments` (Production
  environment) and against the live site itself, not just that the merge succeeded.
- Run `git log origin/main..HEAD` before opening a PR — this tree is shared with concurrent Claude
  sessions, and a clean `git status` says nothing about what's already committed on your branch.

### 3D room facts
- Runs `frameloop="always"` and must — drei's `useAnimations` advances mixers from `useFrame`, so
  demand-mode freezes every seated character. `awake()` reads an "is there pending work" registry
  flag, not recent-paint timing (a shadow-mapped scene under headless SwiftShader renders ~2fps and a
  timing-based check reported it permanently asleep).
- No skybox/backdrop wall is possible beyond the balustrade ring above — every frustum ray hits the
  floor at every shipped aspect. `lib/game3d/floor-environment.ts` derives floor radius from the
  camera fit instead of a wall.
- Camera fit (`frameCamera`) is a numeric search (bisect distance, Newton-step the aim), not a closed
  form — a closed form summed two upper bounds that never co-occur and under-filled every landscape
  aspect.
- Table felt is 2:1 stadium-proportioned (a real six-max table's ratio), derived from
  `TABLE_WIDTH_M`, not independently typed.
- Avatars' hands rest on the felt aimed at their own cards (`lib/game3d/hand-anchors.ts`/
  `arm-ik.ts`/`hand-rig.ts`) — five of six seats are physically out of reach of their own cards; the
  fix aims the wrist a hand-length back from the card rather than leaning the torso (tried and
  reverted — a lean big enough to matter reads as hunching and is unstable in a feedback loop).
  Finger curl is rebuilt per-digit from each joint's own bind-pose geometry, not a uniform curl
  applied to all five (which read as gripping a tube — "holding a flute").
- Chips resolve to explicit per-chip slots (`lib/game3d/chip-instance-model.ts:pileSlot`), not a
  golden-angle scatter — a resting pile's destination and a flight's landing target are the same
  computed value now, which is what stopped chips reading as stacked inside each other.
- 3D character ownership: 6 free starter avatars; Claira/Donni/Jimmy/Kenji unlock at 10/50/150/500
  lifetime hands won; Derek/Oscar/Victor/Marcus cost 1m–6m Gold (`lib/cosmetics/catalog.ts`). Never
  default a generated cosmetic entry to `price: 0` — free catalogue entries are implicit ownership.
- Never call `renderer.forceContextLoss()` in a React cleanup on any WebGL work here — with a
  React-owned canvas plus StrictMode's double-mount, a force-lost context can't be re-acquired and
  permanently breaks the second mount. `renderer.dispose()` alone is correct.

### 2D table facts
- Canvas 2D room (`lib/scene/`), not WebGL — the WebGL room is preserved on `archive/webgl-room` but
  was explicitly reverted at the user's request; don't resurrect it without being asked. `three` is
  uninstalled on `main`.
- The room fits `.poker-rail`'s measured box (not the table wrap's raw width) and solves both radii
  per breakpoint — a fixed radius ratio painted a pancake on portrait phones.
- The pot sits 0.55 of the felt's depth away from the viewer, never at centre (a centred pot stacks
  under the community cards).
- Bet animation is a user preference (`lib/scene/bet-style.ts`): `splash_chunk` (default, staggered
  friction slides) vs. `neat_slide` (one rigid pillar on a clocked ease-out that must terminate
  exactly, so the render loop can sleep).
- Standing street bets rest at the bettor's own seat and sweep to centre only when the street turns;
  the centre pile always renders `pot − Σ streetBet` so felt chips match the HUD number
  (unit-tested invariant).

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
- The only way back into Blackjack/Hi-Lo/duels/poker after busting to 0 Gold is the faucet stack:
  `claimBackstopGold` (`lib/profile/backstop.ts`, 1,000 Gold, open to guests, no wait on a first
  claim — only a 12h cooldown on repeat claims), the daily grant (`DAILY_GOLD_GRANT` × streak
  multiplier, independent UTC-day clock), and rewarded ads for registered players
  (`REWARDED_AD_GOLD` × up to 6/day). All three are already sized off `TIER_CONFIG[CHEAPEST_TIER]
  .minBuyIn` (1,000, the floor for every staked surface in the app), not off a Stripe price — removing
  Buy-Gold didn't touch any of their numbers. Verified 2026-08-13 when Buy-Gold was removed: worst
  case for anyone is bounded by the shorter of "12h since the last backstop claim" or "next UTC day,"
  never indefinite.

### Styling contract
- Chrome (everything except the table) is borderless: separation comes from a raised fill, real
  shadow, and space — not 1px hairline borders. `--accent-edge` (inset ring) + `--accent-glow` stand
  in for a border; `--rule` is the one fading-hairline token for dividers between items (never an
  outline around one).
- Palette: dark obsidian ground (`--brand-ink` `#0a0a0b`), brand purple/red/gold
  (`#983fe0`/`#dc1413`/`#db9c0b`, sampled from the real logo) reserved for the mark and single
  primary actions — not a wash across a whole surface. Table felt/gold (`05-game-header.css` through
  `09-action-bar.css`, plus `16`/`17`/`99`) is untouched green felt and out of scope for chrome work.
- A single unbalanced CSS block comment silently kills the **entire** stylesheet — PostCSS drops it,
  and neither tsc nor eslint reads CSS. `stylesheets.test.ts` guards against an orphaned comment
  delimiter.

### Known open items / gaps
- M17 (chip cosmetics) is deliberately parked until the 3D sim is finished.
- No in-app way to *pick a friend* and challenge/invite them yet — `Seat.profileId` carries the id
  but nothing surfaces a "challenge this seat" control (same gap for PvP duels and M16 table invites).
- PvP duel sync is a 2s poll, not Realtime.
- Blackjack's Supabase persistence branch has never been exercised by a real hand in production
  (only type-checked, plus the memory-mode branch under test).
- `multiplayer.spec.ts`'s six-player test and two `safe-area.spec.ts` table tests fail identically at
  a pristine HEAD worktree, unrelated to recent work — reconfirm against a fresh worktree before
  treating a red run here as a regression (see `[[reference_stackchips_e2e_traps]]`).

Update this section when scope changes; keep `CLAUDE.md` synchronized.
