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
- **This checkout is shared by several concurrent sessions. Do your work in your own worktree**
  (`git worktree add -b <branch> .claude/worktrees/<name> origin/main`), never on a branch in the
  primary tree. Branch-level and destructive git there (checkout/switch/merge/rebase, stash/reset/
  clean/restore, `git add -A`, `git commit -a`) is refused by `.claude/hooks/guard-shared-worktree.sh`,
  because those land under whoever else is mid-task rather than staying local. Reads are always fine;
  `ALLOW_SHARED_TREE=1` in the command is the deliberate override.

## Active milestone

- Track: `ui-redesign-foundation`. Current feature branch: `feat/pvp-duels-ui-sounds-3d-avatars`.

### Homestead migration applied, and a revoke that wasn't revoking (2026-09-01)
`20260831150000_homestead_plots.sql` is **applied to production**, verified against real Postgres with
a self-rolling-back `DO` block rather than trusted from the memory-mode tests (which cannot exercise a
SQL CHECK at all): payout ceilings, both caps of 3 counted separately, the guarded collection paying
once and never tripping the stocking trigger, the feed RPC refusing to go negative. Applying it
exposed a real hole. The migration revoked EXECUTE `from anon, authenticated` but **not `from
public`**, and both roles inherit the default PUBLIC grant, so the revoke was a no-op and
`adjust_homestead_feed` sat callable on `/rest/v1/rpc` -- SECURITY DEFINER, taking the profile id as a
parameter rather than reading the caller's session, so any anonymous caller could move any player's
feed balance, and feed is bought with Gold. Exactly what
`20260813170000_revoke_pvp_trigger_function_execute.sql` exists to fix; that makes twice. The idiom is
`from public, anon, authenticated` and all three names matter -- copy it from `credit_gold`, and check
`proacl` afterwards rather than re-reading the migration (a correct one has no bare `=X/postgres`).
Supabase's advisor catches the SECURITY DEFINER case, so run `get_advisors` after applying anything
that adds a function. Also this pass: `50-homestead.css` renumbered to **52** (main's Nonogram and
Othello took 50 and 51 while the branch was open).

### Homestead ships to prod gated on one account, by env not by code (2026-09-01)
Kayo wants it on production but visible only to his own account. The gate is an allowlist of Supabase
auth account ids in **`HOMESTEAD_ALLOWED_USER_IDS`**, checked in `lib/server/homestead-access.ts`.
**Ids, not emails:** the session cookie already resolves to `profiles.user_id`, so an id costs a
lookup we make anyway, where matching an email would mean a Supabase auth-admin call on every read.
**Env, not committed:** `Nikkayowill/poker` is a PUBLIC repo -- an email is personal data and an
account id names one real person -- so there is no default and **unset allows nobody, including
Kayo**; forgetting the variable is indistinguishable from the feature being broken, so say so wherever
it deploys. Needed `findUserIdBySessionToken` in `profile-store.ts` because `publicProfile()`
deliberately drops `userId` (`isRegistered` is derived from it), so nothing player-facing can name a
specific account. **The PAGE is genuinely gated this time, which the admin version could not manage:**
the player session cookie is `path=/`, so a server component reads it via `next/headers` and calls
`notFound()` -- the admin cookie's `path=/api/admin` was what forced the old "render for anyone, let
the API refuse" compromise. Still 404 everywhere, never 403. **The rate limiter now runs BEFORE the
gate, reversing the old order**: the admin check was a free signature check worth running first, but
this one costs a database read, and gating ahead of the limiter hands an unauthenticated flood a query
amplifier. `homestead-access.test.ts` walks `app/api/homestead` so a route added tomorrow cannot skip
the gate, and asserts the gate precedes `readOrCreateSessionToken`. That ordering test **failed on its
first run against correct code**: it string-matched bare names, and the comment explaining the
ordering names the very function whose position it measures -- it now strips comments and matches
calls (`name(`). Releasing means flipping `status` to `live` AND clearing the variable; either alone
still hides it.

### The staff gate is gone; the Homestead is unlisted, not closed (2026-09-01)
Reverses the entry below, on Kayo's call: "scrap the whole admin access. just let me look at it." The
gate worked but made the game hard to even open -- `ADMIN_SESSION_COOKIE` is per-origin, so the prod
passcode does nothing on a preview deploy, and `ADMIN_SECRET` is scoped per Vercel environment, so a
Preview build without it locks staff out along with everyone else. Deleted `lib/server/staff-gate.ts`
and its test; routes moved back to `/api/homestead[/actions]` (the cookie path no longer constrains
where they live), page to `/games/homestead` beside every other game, and the "Admin session required"
locked state went with them. `ArcadeGameStatus`'s fourth value is renamed **`staff-only` ->
`unlisted`**, because with no gate left the old name was a lie. **Know exactly what `unlisted` buys:
`splitArcadeFloor` still shows only `live` rows, so it stays off the floor -- and that is ALL it does.
The routes are open and move real Gold, so anyone with the URL can play it.** That is the same
"a catalog row is not a lock" lesson `lib/arcade/retired.ts` records, now running in the other
direction: unadvertised, never unreachable. Flipping `status` to `live` is the whole release. If it
ever has to be genuinely closed again, the route must refuse -- that is a separate thing to build, not
a status value. Also worth keeping: **`npm run dev` cannot verify this page at localhost.**
`next.config.ts`'s `allowedDevOrigins` pins a stale `192.168.2.144`, so the page server-renders and
then no client component mounts -- dead canvas, dead buttons, nothing in the console. Build and
`next start` instead; see `[[reference_stackchips_local_testing]]`.

### SUPERSEDED by the entry above: the Homestead was staff-only under /admin (2026-09-01)
Kayo: finished but not for the public yet, reachable only through the admin portal. New
`ArcadeGameStatus` value **`staff-only`** -- a fourth state, not a flavour of the other three: built,
mounted, moving real Gold, just not offered. `splitArcadeFloor` shows only `live` rows so it never
reaches the floor, and per `lib/arcade/retired.ts`'s lesson the routes carry their own gate rather
than relying on a hidden catalog row. **The load-bearing discovery, found by curl and not by
reasoning:** `ADMIN_SESSION_COOKIE` is scoped `path=/api/admin`, so mounted at `/api/homestead` the
gate could not see the cookie that authorises it and 404'd staff as well as strangers. Widening the
cookie to `/` was rejected (the narrow path is what keeps an admin credential off ordinary traffic,
the same reasoning that moved admin auth off a request header) -- the game moved instead:
`/api/admin/homestead[/actions]`, page at `/admin/homestead`, catalog href to match. The PAGE is
deliberately ungated and cannot be gated, for the same path reason; it matches how `/admin` already
works -- renders for anyone, API behind it refuses, stranger gets a locked state. Everything answers
**404, never 403**: a 403 confirms the feature exists. `staff-gate.test.ts` walks
`app/api/admin/homestead` on the filesystem so a route added tomorrow cannot skip the gate, and
asserts the gate runs before `readOrCreateSessionToken` (or probing it hands the prober a session
cookie). Verified live: anonymous 404s on every surface including the old public URLs, admin session
gets 200 and the real service runs.

### Nonogram rebuilt to compete with the picross apps (2026-09-01)
Kayo: make it compete with "the main nonogram games out there" and include everything that makes it
enjoyable. The v1 shipped the day before was a correct nonogram nobody would choose to play: **boards
were 58% uniform random noise**, so solving one revealed static rather than a picture -- the reveal is
the entire reward of the genre and it was missing -- and **every single square was its own HTTP round
trip**, which on a 625-square master board is 625 sequential requests inside a 40-minute clock. Both
are fixed. Boards are now **drawings**: 65 hand-authored pictures at 5x5/10x10/15x15 (cat, anchor,
crown, penguin, guitar...), each one **verified line-solvable by `nonogram-pictures.test.ts` upright
AND mirrored** -- that test is the gate that lets art ship, since ambiguity in a nonogram is invisible
to the eye and this stakes real Gold. Mirroring is the only transform used (a rotated cat is not a
cat, and the reveal is the point). 20x20/25x25 are past what hand art can carry, so they are **grown**:
a mirror-symmetric half-grid smoothed by a majority rule into blobs, then repaired to solvable by the
same strictly-increasing-fill argument the old generator used. The library is `server-only` behind the
new `nonogram-deal.ts` and the engine takes a *dealt* board rather than importing one -- the
arrangement `connections.ts` has with `connections-puzzles.ts` -- because `nonogram.ts` is
client-imported and the library is the answer key; verified absent from `.next/static` after a build,
not assumed from tree-shaking. Gameplay: **strokes** (`markNonogramCells`, one request per drag,
axis-locked client-side) that **stop at the first wrong fill**, so a drag past the end of a run costs
one mistake rather than one per square; **auto-cross** (chosen at deal, stored on the round, sound
because a mark can only ever be a *correct* fill so marks matching a clue mean that line is finished);
**undo** (bounded 20 strokes, never unfills a square the board has proved, never refunds a mistake);
**hints** that cost a mistake and refuse to spend the last one (a free hint on a no-guess board is a
free square, and enough of them is a board that pays without being played). Plus per-clue-number
strike-off (`nonogramClueProgress`, in the engine so it is testable and cannot drift from the
component), a row/column crosshair, zoom, a Pan tool (squares are `touch-action: none` so a finger
paints; Pan is what hands the drag back to the scroller), full keyboard play, a progress bar, a
localStorage personal best, and the finished picture revealed clean with its name. Real CSS bug found
and fixed while shooting screenshots: **`--ng-clue-step` was declared on `.ng-match`, so its
`calc(var(--ng-cell) * .66)` resolved against that element's 24px fallback and never against the
per-rung `--ng-cell` set inline on `.ng-grid`** -- descendants inherited the already-resolved value --
which silently clipped the top number off every two-deep column clue; see `app/styles/CLAUDE.md`.
**Still open: the tiers were not retuned and should be.** They were set against random-noise boards
that almost nobody finished; drawings with real runs in them plus drag-painting move the win rate up
by an unmeasured amount, and expert/master pay 3.2x and 5x. `ANTE_UP_NONOGRAM_TIERS`' own header now
says so. Solve-rate data from real attempts is the honest input; `ante-up-stakes.ts`'s ceilings bound
the damage until then.

### The Mint became the StackChips Homestead: crops, feed, muck, three times of day (2026-08-31)
Kayo's expansion spec (his own, written in the homestead branch's register) plus the rename:
`sovereign-mint` -> `homestead`, `mint_plots` -> `homestead_plots`,
node types `pulse|core|matrix` -> `hen|pig|cattle`. Free to do because the migration was still
unapplied; after it lands this is a data migration, not a find-and-replace. Five plot states now
(`locked|empty|working|hungry|ready|mucked`) across two tracks with **separate caps** -- 3 pens and 3
fields -- because crops sharing the livestock budget makes them just a cheaper animal.
**Three corrections to the spec, all load-bearing.** (1) Its flat maintenance fee is arithmetically
impossible here: at 20% muck and a flat 1,500, a Hen Coop's +50 net becomes **-250 a cycle**, so the
tier new players start on is a guaranteed loser. `muckFee` is now 2x the tier's net bonus, holding
expected muck cost at 40% of what the plot earned on every tier -- there is a test asserting exactly
this. (2) Its `#1A1A1D`/`#222226` are the homestead demo's near-black stage, which Kayo had already
ruled out ("DONT COPY THE BACKGROUND"); states map onto our dusk palette instead. (3) **A 20% roll
cannot be computed on read.** Everything else here is a pure function of timestamps, which is why the
feature needs no background jobs; a dice roll evaluated on read re-rolls on every refetch and a player
rerolls muck by pulling to refresh. It is rolled once in `rollMuck`, server-side, inside the guarded
settlement write, and stored. **Hunger freezes rather than kills** (Kayo asked whether animals should
die; the blocker is that per-plot push is not buildable on this stack, so a feed deadline is one the
app is structurally unable to warn about): a hungry pen stops, and feeding pushes `ready_at` forward
by the time spent hungry, so neglect costs time and never Gold. That is also why readiness is no
longer a pure function of `started_at` and the row has to remember `last_fed_at`. Feed is a per-player
consumable behind a row-locking RPC (`adjust_homestead_feed`), same posture as `credit_gold`. Only
Pig and Cattle can ever go hungry -- a Hen's hunger window is deliberately longer than its own cycle,
so the cheapest tier stays fire-and-forget. World gained `morning|dusk|night` tones picked from the
player's own device clock at boot; only colour and light change, because re-lighting from a different
angle would mean re-authoring every prop's shading three times. Supply store is a sheet off a HUD
button. 35 new tests.

### The Mint's diorama became an outdoor farm; landscape CSS was measurably wrong (2026-08-31)
Kayo, on the first cut: "why is the platform floating in the sky?" -- and it was, literally. The
scene drew a violet slab on a `transparent: true` canvas, so the app's own dark ground showed through
underneath and the whole treasury read as a platform in a void, while the panel beside it talked
about surveying the grounds and crews tending nodes. The whole static world now lives in
`mint-world.ts`, painted once into ONE canvas texture at boot (Canvas2D, not `Phaser.Graphics`: real
gradients and soft radial shadows, and one quad instead of a command list re-walked every frame).
**Land runs off all four edges** -- there is no platform to fall off. Distance is a hazy hedgerow
along the top rather than a sky, because the grid already spans y 67..441 of a 470-tall stage and a
real horizon band would have had to shrink tiles that are already near the touch-target floor in
landscape. Three rules worth keeping: (1) **owned plots are the warmest thing in the frame** -- the
first cut had bright green scrub for LOCKED plots against violet-grey soil, so twelve unusable tiles
were the most inviting thing on screen; warm turned earth vs. cool dark scrub is also the grid's only
real colour contrast on a phone. (2) Crops are **violet while growing, gold only when ripe**, drawn
as two faces meeting at a ridge -- filled triangles with a lighter triangle inside made every ripe
plot look like it was on fire. (3) Cloud shadows sit ABOVE the plot layer (`DEPTH_CLOUD` 800): the
plots cover the field bed completely, so a shadow underneath disappears the moment it reaches the
field. Only plot tweens are tracked for removal; Phaser does not kill a tween when its target is
destroyed. **The landscape breakpoint was broken and the number was the bug**: `calc(100dvh - 128px)`
assumed 128px of chrome where the real total (safe area, floor bar plus its `clamp()`ed margin,
scoreline, two shell gaps) measures ~160px at 844x390, hanging the diorama 30px below the fold on the
exact device the breakpoint exists for. The shell is now a fixed-height flex column and the stage
takes what is left, no magic number. Its `@media` block **must stay last in `52-homestead.css`** -- it
overrides base rules at equal specificity, and it silently lost every panel rule while it sat above
them. Node cards go 2x2 grid there (name/terms, yield/button); three portrait cards are ~300px
against ~260px of height, and a wrapping flex row broke each card at a different word. Verified by
screenshot at 900x900 and 844x390, populated via a route-intercepted fixture, plus reduced motion.

### Sovereign Mint: an idle treasury of staked, timed Gold nodes (2026-08-31)
Built from a GameDesigner-agent GDD Kayo brought in, after an engineering review rejected its
economy outright (guaranteed 150-200% ROI with no cap: the Ante Up money printer with the variance
removed). The shipped frame is deliberate: **flat net bonuses, never percentage ROI** (Pulse 1,000
stake -> +50 in 15min, Core 10,000 -> +600 in 4h, Matrix 50,000 -> +2,500 in 24h) plus a
**3-concurrent-node cap**, so max guaranteed income is ~7,500/day (rewarded-ads territory) and
cannot compound with bankroll; plots 5-16 are a pure sink (2,500 doubling per tile), and owning
more plots is never more income. Kayo's renderer call: **Phaser 2D, no 3D** ("dont use 3d") --
`phaser` pinned 3.90.0, entering the bundle only through `mint-canvas.tsx`'s dynamic import (a
1.2MB lazy chunk referenced by no page manifest; verified). Server mirrors Ante Up exactly:
`lib/mint/` (tuning + pure derivation), twin-branch `mint-store`, `mint-service` restating the
money-ordering rules, `payout`/`matures_at` snapshotted at plant (the wagerLadder rule), harvest a
single guarded UPDATE (version + status + `matures_at <= now`) that pays at most once, plus an
append-only `mint_harvests` ledger. Migration `20260831120000_mint_plots.sql` follows the
trigger-not-CHECK lesson (fires only when a row turns growing, advisory-locked cap count) --
unapplied, see `[[reference_stackchips_migrations_not_auto_applied]]`. Client: canvas is pure
paint; input/a11y is a DOM overlay of real buttons sharing coordinates via `iso.ts` (canvas is
invisible to screen readers). Two rules enforced by tests caught real bugs while building: GET
`/api/mint` must use `readSessionToken` not `readOrCreateSessionToken` (session-minting.test.ts),
and the catalog row's `entryCost` is 0 so a broke player is never wallet-gated away from their own
ripe harvest. No XP on plant (a riskless stake must not feed progression), no missions, no
leaderboard. Deliberately deferred with the GDD's blessing withdrawn: per-node push (infra can't),
monuments/adjacency boosts/cosmetic grid skins (purchased-cosmetic yield amplifiers touch the
gambling-law posture and need Kayo's own call).

### Ante Up copy pass, plus Nonogram and Othello (2026-08-31)
Kayo: the Ante Up heading ("Eleven more ways in.") "makes no sense and is old", every card blurb
needed rewriting, and the heading had to match the other tabs. It now follows the house head shape
every other floor already used (kicker / short noun phrase / one line): **Ante Up / "Every game
beside the table."** The old line counted the catalogue through a number-to-words table (`spell()`,
deleted) -- a count baked into a sentence goes stale the day a game ships, which is the rule
`lib/arcade/games.ts`'s own header records three times and which broke three more places found in
this pass: the hub tile shipped reading a literal **"0 free every day"**, the first-run strip
literally read **"0 puzzles are free every day"** (both counted `kind: "puzzle"`, a bucket empty
since the 2026-08-21 move of every brain game to `kind: "wager"`), and the same strip said "Ten more
games" against a catalogue of thirteen. Blurbs described the *price* rather than the game, so three
cards said the identical "Wager Gold, or play free — any time" and two more said "1v1, winner takes
the pot", while the stake line directly beneath said it again; every blurb now names its own
mechanic. Section heads: "Ante up" (colliding with the tab of the same name) -> **Beat the board**,
"Staked in Gold" (true of all three sections) -> **Against the house**, "Player vs. player" -> **Head
to head**. The floor's how-it-works modal opened "Every Ante Up game can be played completely free",
untrue of Blackjack and the five duels; now scoped to the solo boards, and carrying Nonogram's rules
(Kayo asked for them there specifically).

**Nonogram** (12th solo game, `/games/nonogram`) and **Othello** (5th duel, `/games/othello`) shipped
in the same pass. Nonogram runs 5x5 to 25x25 on five rungs (easy/medium/hard/expert/master), and its
generator carries the same no-guess guarantee Minesweeper's does, by the same reasoning: a puzzle
needing a guess is a coin flip and this stakes real Gold. `lib/arcade/puzzles/nonogram.ts`'s line
solver is a two-pass DP over (position, run), not an enumeration of arrangements -- a 25-wide line
with six runs has thousands. **The generation loop provably terminates rather than merely usually
terminating**: when line logic stalls, the repair *adds* a filled square, which strictly increases
the filled count, and the all-filled grid (every clue a single run the width of the board) is
trivially solvable, so it cannot run past `size * size` repairs. In practice it is a handful or none
-- 25x25 generates in ~2ms, worst case ~7ms, measured. Only a wrong *fill* is scored; a cross is
player notation and free, which is what lets the mistake budget be small (3 at 5x5 up to 6 at 25x25).
The board does not shrink to fit a phone the way Minesweeper's does -- 625 squares at a tappable size
will not fit, and `.ng-frame` scrolls in both axes instead. Othello was picked over Connect Four for
one reason: **Connect Four is solved**, and a player who has memorised the first-player win would farm
every opponent they got seat 0 against, for real Gold. Its two rules worth knowing are in the engine
header (a move must flip something; a player with no legal move passes and does not lose, and only
when neither side can move is it over -- which is usually but not always a full board). No draw or
repetition rules: every move fills a square, so it cannot loop. Balance conservation verified live
end to end (4,000 Gold across two players before and after). Migration
`20260831140000_othello_leaderboard.sql` adds 'othello' to `global_leaderboard_entries()` and is
**unapplied**; see `[[reference_stackchips_migrations_not_auto_applied]]`.

### Word Stack and Connections now carry their payout ladder (2026-08-27)
Closes the gap left open by the Ante Up economy fix earlier the same day. Both games computed their
payout from a module-level multiplier table *at settlement*, and both are once-a-day boards that can
be opened in the morning and finished at night, so a retune landing in between paid the player at a
rate they never agreed to. That was not hypothetical: the same-day retune moved Word Stack's
six-guess rung 1.5x -> 0.7x and Connections' three-mistake rung 1.5x -> 0.6x, either of which flips a
board already in progress from a profit into a loss. `StoredWordStackRound`/`StoredConnectionsRound`
now carry an optional `wagerLadder` copied in at open and never re-read from the module, the same
rule `AnteUpAttempt.multiplier` and `AnteUpMinesweeperAttempt.timeLimitMs` already state in their own
doc comments; `lib/arcade/ante-up-ladder.ts` holds the shared lookup. Stored only when `wager > 0`
(a free round has no payout to protect) and carried forward on every guess, not just at open. Rounds
written before the field existed fall back to the live table, which is the best answer available and
exactly what they would have got anyway. **Memory Match has the same defect and was deliberately left
alone** — its multiplier is a range function rather than a lookup map, so snapshotting it means
converting the if-chain to a rung array, and its exposure is minutes (one sitting, one-active-per-game)
rather than a whole UTC day.

### Ante Up was a money printer; wager ceilings + a payout retune (2026-08-27)
Kayo reported real farming ("my gf was easily farming coins"), and it was the design working as
written, not an implementation hole. Two compounding bugs: **no maximum wager existed anywhere in the
app** (every route `z.number().int().min(0)`, the only bound being the player's balance), and
**near-certain wins paid well above 1x** — easy Sudoku gave 15 minutes on a guaranteed-solvable grid
for 1.5x, and Memory Match had *no* winning turn count that paid under 1x. Stake everything on the
safest board, win, restake: at 1.5x with the 10/game/day cap, 100k compounds to ~19B in a day across
three games. Fixed both halves. Ceilings live in one new `lib/arcade/ante-up-stakes.ts` (Sudoku easy
5k → expert 500k; Minesweeper beginner 5k → expert 500k; the three games with no difficulty axis get
25k flat), enforced in all five `open*`/`start*` services before any Gold moves. Payouts retuned down
across all five games; the slow rungs at Memory Match, Word Stack and Connections now deliberately
**pay back less than the stake**, so clearing a board is not by itself profit. Sudoku's clock ladder
also ran backwards (easy 15 min, expert 5) and now grows with the grid. Memory's turn cap 20 → 16.
Three things worth keeping: (1) the DB guard is a **BEFORE INSERT trigger, not a CHECK constraint** —
a CHECK re-evaluates on every UPDATE, and since every settlement here is an UPDATE that *throws*, one
pre-deploy over-ceiling attempt would have been permanently unsettleable, 500ing its page forever
while the one-active-per-game index blocked any new attempt (verified rollback-safe against the live
DB; a legacy 10k row still settles cleanly under the trigger). (2) `ANTE_UP_MEMORY_MAX_TURNS` is now
**snapshotted onto the attempt** (`maxTurns`), since a retune of a forfeit condition otherwise takes a
wager for a move that was legal when made — Sudoku/Minesweeper already did this, Memory was the odd
one out. (3) Every board keyed its win celebration off `payout > 0`, which sub-1x rungs made a lie
(1,000 staked, 600 back, rendered "+600 Gold" under a gold bloom); `lib/arcade/ante-up-result.ts` now
computes net once for all five. **Still open:** Word Stack and Connections compute payout from the
live table at settlement, so a daily round opened before a retune and finished after is paid at the
new rate — land retunes at a UTC day boundary, or snapshot the multiplier into the round (its own
pass). Migration unapplied; see `[[reference_stackchips_migrations_not_auto_applied]]`.

### Cribbage sync moved off its fixed 2s poll onto Realtime, same pattern as duels (2026-08-27)
Follow-up to the PvP duel Realtime migration (below) — Kayo asked for cribbage on the identical
pattern, named `crib`. Two channels, not one: `crib:lobby`, a single global channel every browser on
the open-table join screen shares (GET `/api/cribbage` lists open tables across every stake with no
per-viewer filter, unlike a duel's own challenge list, so there's no narrower key to give it), and
`crib:<tableId>` once seated. Both fired by a new `broadcast_crib_signal()` trigger on writes to
`cribbage_tables` **and** `cribbage_table_players` — the latter matters because `claim_cribbage_seat()`
(joining) only ever writes the seat table, never `cribbage_tables` itself, so a trigger on just the
table would silently miss every join and the open list's seated-count would never update. Real bug
caught writing the trigger: `NEW`/`OLD` are unassigned records (not null-valued rows) for the
row-trigger operation that doesn't apply, so a naive `coalesce(new.table_id, old.table_id)` on the
DELETE-only-for-leaves table raises "record is not assigned yet" — fixed by branching on `TG_OP`
explicitly instead. Same shell changes as the duel branch: keyed on `tableId` (a primitive) rather than
the table object so a move's version bump doesn't tear down and resubscribe the channel, a 15s backup
poll alongside the channel (no other seated human's turn-clock tick to notice a stale socket the way
poker has), no fallback poll when Supabase isn't configured (same posture the duel branch settled on
after Kayo asked for its own fallback to be removed), and the same 429/Retry-After backoff
duel-shell.tsx carries. Migration applied 2026-08-27 (`crib_realtime_signals`, verified via
`list_migrations` and a clean security-advisor pass).

### PvP duel sync moved off the fixed 2s poll onto Realtime (2026-08-27)
Resolves the "known open item" below (now stale where it's still quoted). `duel-shell.tsx`'s own
comment had called the 2s poll deliberate, judging Realtime "a bigger change than these games need" —
Kayo asked for it anyway. New per-profile channel `pvp:<profileId>` (`lib/pvp/duel-channel.ts`), fired
by a `broadcast_pvp_signal()` trigger on every write to `pvp_challenges`/`pvp_matches` naming that
profile — mirrors `table-channel.ts`'s invalidation-ping contract, but keyed per-player rather than
per-game since a challenge has no match id yet to key on. Carries no version (unlike the table
channel): a challenge and a match don't share one monotonic counter, so the payload is empty and any
broadcast just triggers a full lobby re-fetch. A slow 15s backup poll still runs alongside the channel
as a safety net against a stale-without-erroring socket — poker's realtime has the turn-clock's own
deadline pull to fall back on; a 2-player duel has no other seated human to notice for it. No fallback
poll otherwise (removed after Kayo asked for it): when Supabase isn't configured (memory-mode dev) or
this browser's own profile id isn't known yet, the effect just doesn't subscribe, same posture
`poker-app.tsx` already takes. Migration applied 2026-08-27 (`pvp_duel_realtime_signals`, verified via
`list_migrations` and a clean security-advisor pass) — the general "verify before trusting a historical
note" caution below still applies to older entries; see
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
