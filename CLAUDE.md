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

- Track: `ui-redesign-foundation`
- **The 3D room has a real modelled backdrop now (2026-08-12): a brass
  balustrade, walls, a bar and two glowing pendant lamps, from a GLB the
  owner supplied** (`public/environments/stackchips-room-surround.glb`,
  `components/game3d/scene/room-surround.tsx`). A second supplied file,
  `stackchips-poker-room.glb` — a *complete* alternate scene with its own
  table/chips/dealer tray, on a different scale than this app's table — was
  deliberately left uninstalled; using it would double the app's own table
  geometry. Three things worth not relearning:
  - **`floor-environment.ts`'s "no wall is possible" claim was checked
    against this exact asset, not re-argued from first principles**: sampling
    both the asset's `walls` ring (radius ~5.58, top ~3.38) and its
    `balustrade` ring (radius ~3.55, top ~1.18) against `frameCamera`'s real
    frustum at every shipped aspect confirms the walls' top is visible from
    **zero** angles at **any** aspect — exactly what the claim predicts — while
    the balustrade, being closer and much shorter, genuinely reads on screen.
    The whole asset ships anyway (5,378 triangles, cheap) rather than trimming
    the invisible parts; only the asset's own `carpet_ring` was dropped, since
    it sits exactly coplanar with `CarpetFloor` at y=0 (a z-fighting pair) and
    can't recolour itself the way `carpetColorAt` does on a `RoomTheme` swap.
  - **Not routed through `props/instanced-prop.ts`'s `buildInstancedProp`.**
    That helper's material clamp is tuned for the chip roster's clay finish
    (metalness ceiling 0.12) and would have dulled this asset's brass trim
    (authored at 0.35, meant to catch the spot). There is also nothing here
    instancing would collapse — 13 mesh nodes, none repeated — so it's a plain
    recursive `scene.clone(true)` into the same stable-container-built-inside-
    the-disposing-effect shape `HoleCardProp` already established, for the
    same StrictMode double-mount reason documented there.
  - **Verified on the real GPU, not headless** (`ANGLE (AMD, AMD Radeon 660M
    …)` via the debug-renderer-info extension, through `/game3d`'s
    no-server-required scripted demo route) at 1440×900, 390×844 and 2560×1080
    — the balustrade arcs across the top of frame at every one, the two
    pendant lamps glow (their material is emissive, independent of scene
    light), and nothing z-fights with the carpet.
- **The rewarded-ad faucet changed shape on 2026-08-11: 5-minute wait (was
  30s), a direct "Free Gold" entry point, and the live Adsterra unit.**
  `REWARDED_AD_GOLD` was already 500; only `REWARDED_AD_DURATION_MS` moved
  (30_000 → 300_000, `lib/rewards/config.ts`), and `REWARDED_AD_GRANT_TTL_MS`
  went 10min → 20min with it so a distracted player still has a real margin
  to hit Claim after a 5-minute wait rather than the wait eating the whole
  window. `REWARDED_AD_UNIT.scriptSrc` (`lib/ads/adsterra.ts`) now points at
  `pl30614359` — the account's current zone — replacing `pl30614360`; no CSP
  change was needed since both are `effectivecpmnetwork.com` and that origin
  was already wildcarded. Previously this offer only ever appeared when
  `advanceRewardWatch` noticed a game event (a busted hand, a big pot); there
  was no way to ask for it. The lobby player menu now has a "Free Gold" row,
  shown under the same threshold that trigger already used
  (`REWARDED_AD_ELIGIBLE_BELOW` = `TIER_CONFIG[CHEAPEST_TIER].minBuyIn`,
  currently 1,000) — registered accounts only, same as daily Gold, since a
  faucet aimed at guests is a faucet aimed at whoever clears cookies fastest.
  It opens the same `RewardedAdModal` rather than a second implementation,
  through a `freeGoldOpen` flag in `poker-app.tsx` kept deliberately separate
  from `useGameAchievements`' one-offer-per-kind-per-session bookkeeping — a
  menu row the player clicked on purpose must reopen every time they're
  still eligible, not once and then never again. It re-hides itself: balance
  crossing back over the threshold falls out of recomputing eligibility from
  live `profile` state each render (no extra plumbing), and the daily cap
  (`REWARDED_AD_DAILY_LIMIT`, unrelated and unchanged) is tracked via a new
  `remainingToday` value threaded back out of `RewardedAdModal`'s
  `onCredited`/`onDailyLimitReached`, since the profile itself carries no
  claims-today count for the client to read. Also fixed in the same pass,
  reported alongside the rest: the guest player-menu row read "Save
  progress" while calling the exact `signIn()` the header's own `AuthButton`
  labels "Sign in" for the same guest — same action, two names. It is
  "Sign in" now, in both places.
- **A repo-quality pass ran on 2026-08-06 and deleted a dead subsystem.** Four
  things worth carrying forward:
  - `lib/server/table-manager/` (13 files) and `lib/server/cash-game-session-
    store.ts` + its test are **gone** — 2,563 lines that nothing imported. The
    persistent Node worker they were written for never had an entry point, and
    `assertPersistentTableRuntime()` threw under `process.env.VERCEL` anyway.
    The live cash-out path was always `creditGold` in
    `app/api/games/[id]/actions/route.ts`. Recover with
    `git checkout c372499 -- lib/server/table-manager lib/server/cash-game-session-store.ts` if a worker is ever built for real. The `cash_game_sessions` table, its RPCs and
    its migration **stay in the database** — migrations here are append-only,
    and dropping a ledger table to tidy a code deletion is not a trade worth
    making. `lib/game/table-channel.ts` is now the sole surviving definition of
    that broadcast envelope, and its header says so.
  - Also deleted: `components/table/pot-pile.tsx` (this file already claimed it
    was gone), `components/table/room-code-chip.tsx` with its `.room-code-chip`
    rules in `05-game-header.css`, and `lib/ai/models.ts`. `.playwright-mcp/`
    is untracked and ignored. Note `lib/game/pot-chips.ts` is **alive** —
    `lib/scene/` reads it; only the CSS-era component died.
  - `STAKES_TIERS` in `lib/game/tiers.ts` is now a `readonly` tuple and
    `StakesTier` is derived from it, so the ladder has one definition instead
    of three. Four routes had hand-written `z.enum(["1k", …, "500k"])`; they
    take `z.enum(STAKES_TIERS)` now. That drift was a live hazard, not a
    tidiness point: a ninth tier would have been offered by the lobby, priced
    by `TIER_CONFIG`, and then rejected by every route that takes a wager.
    `lib/game/tiers.test.ts` pins the derivation.
  - The e2e suite is **41/41 green**. `tests/e2e/multiplayer.spec.ts` had been
    failing since `b8cfabf`, which renamed the hub tile to "Texas Hold'em"
    without updating the selector that looked for "Join table". That commit's
    message cites unit tests, eslint and `next build` — the three gates that
    cannot see a Playwright selector. Run `npm run test:e2e` before claiming a
    UI-copy change is done; the CSS/e2e gap is exactly what
    `vitest.config.ts`'s comment warns about for stylesheets.
- **Two shared modules replaced copy-paste, both with tests the originals could
  not have had.** `lib/server/arcade-request.ts` holds `ArcadeRequestError`
  (generic over snapshot *and* over each game's `reason` vocabulary) plus
  `toArcadeErrorResponse`; blackjack/hi-lo/wordle/connections keep one-line
  subclasses so `instanceof` still narrows per game, which both the services
  and their tests rely on. The four copies had already drifted — two had
  dropped `reason` entirely. `lib/profile/stored-preference.ts` +
  `components/use-stored-preference.ts` replace three near-identical
  localStorage blocks in `poker-app.tsx` (22→10 `useState`, 18→15 `useEffect`).
  The pure half is in `lib/` deliberately: `vitest.config.ts` collects only
  `lib/` and `app/`, and the legacy-key migration living in a component meant
  the one piece of logic with a real incident behind it — the StackChips rename
  silently un-muting everyone who had muted the app — was unreachable by
  `npm test`. It has seven cases now. The hook's `apply(value, cause)` carries
  `"restore" | "change"` because enabling sound plays a confirming click and
  restoring it must not: that distinction was implicit in the old code and is
  the kind of thing an extraction loses silently.
- Mobile PWA launch prep is done and live on production (installable shell,
  safe-area fixes, the Adsterra CSP fix) — see the deploy note further down
  for the exact commit/PR this shipped in. Menu music is done and audible now
  — engine *and* a real seven-track playlist; see its own bullet below. A
  silver/platinum "Prestige" reskin of the app chrome was built and pushed to
  a Preview deployment for review, then explicitly reverted at the user's
  request before it reached `main`. Don't resurrect that work. Note the
  palette rule has since been *split* rather than repealed — see the brand
  bullet immediately below. M16's remaining invite work is still parked, not
  abandoned — see the M16 note below.
- **The chrome is purple/red/gold now; the table is still green felt.** The
  user supplied their real logo — a "STACKCHIPS / HIGH ROLLER ARCADE" badge —
  and asked for a modern, borderless frontend around it, explicitly scoping
  out the in-game HUD and tables. So `--brand-purple` `#983fe0`,
  `--brand-red` `#dc1413` and `--brand-gold` `#db9c0b` live in
  `01-tokens.css` and dress the sign-in page, landing page, lobby hub, menus,
  modals, store, collection and leaderboard; `--felt`/`--gold` and
  every sheet from `05-game-header.css` through `09-action-bar.css` plus
  `16`/`17`/`99` are untouched. The three brand hex values were **sampled
  from the logo PNG with ImageMagick**, not picked by eye, so the mark and
  the chrome cannot drift. Reaching for a `--brand-*` token inside a table
  sheet is a mistake, not a shortcut. **Superseded in part on 2026-08-08 —
  see the "reskin of the same floor" bullet below.** The three brand hex
  values and the chrome/table scope split are unchanged; where the purple
  goes is not.
- **The chrome is a reskin of the same floor now (2026-08-08): blue-grey
  ground, accent as a line and a glow, rules that fade, 8px radii, and the
  brand sweep reserved for the mark.** The information architecture is
  untouched — same header, one scrolling hub of tiles, Collection and the
  arcade behind their own routes. What changed is the surface, plus two
  structural moves the mock forced. Seven things worth not relearning:
  - **The ground is `--brand-ink` `#12161f`, and it was matched against the
    supplied mock with ImageMagick rather than picked by eye** — the mock's
    page ground samples rgb(18,19,26)–(22,20,33) and the built page renders
    rgb(18,22,31). Same discipline as the logo sampling above, and it settled
    a real disagreement: two intermediate values *looked* "still near-black"
    against the screenshot at a different scale and measured correct. Sample
    the reference; do not eyeball a dark palette.
  - **`--brand-sweep` now has exactly one legal consumer**, `.entry-aurora`,
    which blooms it behind the sign-in logo. It is the mark's gradient, so
    the only place it may appear is light coming off the mark. The last other
    caller was `.save-progress-icon` in `13-status.css`, which wore the whole
    purple→gold→red arc on a notice icon. A token comment states the rule.
  - **The accent is `--accent-edge` (an *inset* 1px ring) plus
    `--accent-glow`, never a fill.** Inset so it adds no layout box — hover
    and selection shift nothing by a pixel. One saturated fill is still spent
    per surface, on the single primary action (the sign-in segment, the gold
    CTAs); `.tier-card.selected` gave up its purple/gold wash for the edge,
    which is what lets the gold *type* do the confirming.
  - **`--rule` is the fading hairline, stated once.** Every rule left in the
    chrome is a divider between things, never an outline around one — a line
    running edge to edge quietly re-reads as the top of a box. `.entry-divider`
    had this hand-written; it and the new floor section heads share the token.
  - **The arcade is a route, `/games`.** The hub tile was ten scrolling rows
    in a 2×2 grid cell with a deliberately half-cut fifth row as the only hint
    it scrolled; it is a summary with a **See all** now, and
    `components/arcade/arcade-floor.tsx` is the catalogue — free dailies as
    cards, staked rounds as dense priced rows. **Dropping the tile's
    `grid-row: span 2` is arithmetic, not styling**: it frees the cell friends
    moved into, which frees the two cells the code form needed to go back to
    `1 / -1`. All three had to change together or the hole the arcade panel
    was added to close reopens. Verified by measuring every tile's rect at
    1440 — four full rows, no leftover cell.
  - **Tile labels moved to the top and the art stayed at the bottom corner,
    and `12-responsive.css` had to flip in the same commit.** The phone rule
    put art top-right to avoid a label that was then bottom-left; once the
    base flipped, top-right art landed straight across a top-left label. Two
    rules, one decision — if either moves, both move. Desktop art also shrank
    (96→82px etc.) because a 146px tile minus a ~50px label leaves ~86px, and
    the scrim cannot rescue art under text when it fades *toward* the art's
    own corner. Both caught on a render, not by reading the CSS.
  - **The player-name field left the hub head** for the buy-in modal
    (`.buyin-name`, `11-panels.css`) — an empty text input was the first thing
    on a screen whose job is "pick your game", and it was the third control
    setting the same name (the profile modal's "Display name" is the durable
    one). Same `id`/label, so `getByLabel("Player name")` still resolves;
    `tests/e2e/multiplayer.spec.ts` had to fill it *after* opening the dialog.
- **The signed-out page is the login form and nothing else now (2026-08-09),
  standing on a casino ceiling, and both headers are the mark alone.** The
  landing page under the form is *deleted*, not hidden:
  `components/auth/landing-sections.tsx` (game grid, nine feature cards, offer
  line, CTA, four-column footer) and `components/pwa/install-cta.tsx` are gone
  with their ~500 lines of CSS. Seven things worth not relearning:
  - **A `z-index: -1` child is invisible under a parent that paints an opaque
    background and is not a stacking context.** `.entry-sky` was complete and
    correct and rendered as flat black, because `.account-entry-page` is
    `position: relative` with `z-index: auto` — so the negative layer escaped
    to the *root* stacking context and painted behind that page's own
    `--brand-ink`. `isolation: isolate` on the page is the fix and is
    load-bearing. `.lobby-hub::before` gets away without it only because
    `.lobby` has no background of its own. Found on a render; nothing else
    could have found it.
  - **The sky is CSS only and deterministic**: two tiled star fields on
    `.entry-sky::before/::after` and five hand-placed `.entry-orb` spans on
    long keyframes. No canvas, no timer, no `Math.random()` — same contract
    `lib/scene` holds presentation to, and for the same reason. Softness is
    gradient falloff, never `filter: blur()`: five blurred elements is five
    intermediate layers per paint.
  - **A "1px" star is invisible; the first pass was tuned in the file and
    rendered as nothing.** A `radial-gradient(1px 1px …)` that then fades to
    transparent draws well under a device pixel of ink. 2–3px is what shows.
    The centre shade had the same problem in reverse — at 900×620/.82 it
    swallowed the whole field. Both were set against a real 1440×900
    screenshot; set any change to them the same way.
  - **The form had to lose ~155px to stop scrolling on a laptop, and the
    tagline is not where that came from.** It measured 904px against an 818px
    page at 1440×900 — a sign-in screen that scrolls on a desktop. A first cut
    deleted the signed-out tagline to buy the room; the user put it straight
    back ("keep the tagline, I just meant to get rid of all the text
    underneath"), which is the scope line worth keeping: *the sections below
    the form* were the clutter, the one sentence saying what the product is
    never was. The height came out of the logo, the headline, the tagline's
    own size and every gap instead — 750px now against 760px of usable page.
    That is ~9px of slack, so re-measure on a render rather than trusting
    these numbers if anything is added back.
  - **With the card gone, `--brand-surface` (a 5.5% white wash tuned to sit on
    an opaque card) is a ghost with stars through the middle of a password
    field.** Both surface tokens are redefined *locally* on
    `.account-entry-page` — same roles, same call sites, an ink base under
    them — so every filled control on the page fixes itself and nothing else
    in the chrome moves.
  - **Every button on that page is one radius (`--radius-control`), which
    means the segmented control's track cannot also be it.** Concentric radii
    want outer = inner + the padding between them, so the track grew to
    `calc(--radius-control + 4px)` rather than the buttons shrinking below the
    shared value.
  - **`stylesheets.test.ts` has a new case: no orphaned comment delimiter.**
    An edit here appended a paragraph past the end of an already-closed CSS
    comment; braces stayed balanced, tsc and eslint do not read CSS, and
    PostCSS rejected the *entire sheet* — every rule after it dead, with no
    console on a production build. The dev server caught it; nothing in CI
    would have. Note the test's own explanation has to use line comments,
    since it cannot contain a block-comment delimiter.
  - Nav: the "StackChips / HIGH ROLLER ARCADE" span is gone from
    `poker-app.tsx` *and* `poker-table.tsx` (`.wordmark-mark-only`, gap 0).
    Still `StackChipsMark`, not the full badge — removing the words gave the
    row no more vertical space, so the ≥96px rule is unchanged. The lobby's
    mark carries `role="img"` + `aria-label`, because the SVG is `aria-hidden`
    and the header would otherwise have no accessible name; the table's stays
    hidden since its button already has one. Four now-dead rules in
    `12-responsive.css` that hid the tagline at narrow widths went with it.
  - What stayed below the form, deliberately: the PWA step (one line —
    `installShortStep` in `lib/pwa/platform.ts`, beside the long form so the
    two cannot describe different taps), the play-money disclosure, and a real
    support address. No invented links; there is still no terms route.
- **The hub has one numbered first-run strip, and it retires itself.**
  `lib/lobby/first-run.ts` is the whole rule set (steps, retirement, the
  counter) in `lib/` so `npm test` reaches it — 12 cases;
  `components/lobby/first-run-strip.tsx` is markup. Four points:
  - **Retirement is one stored flag, not a flag plus a prop.** Two things
    write `stackchips:first-run-done`: finishing the strip, and *reaching a
    table* — the second from an effect in `poker-app.tsx`, because the strip
    is unmounted by then (Lobby is replaced by PokerTable). A first cut also
    mirrored it into React state and tripped `react-hooks/set-state-in-effect`
    for good reason: the state bought nothing, since the same swap that
    unmounts the strip is what makes it re-read the flag.
  - **Absent/unrecognised means "not yet retired"** — deliberately the
    opposite default from the sound and music preferences, whose convention is
    "on unless exactly `false`". Failing open here hides onboarding from the
    one player who needs it, and nothing on screen would ever explain that.
  - **`useSyncExternalStore`, not `useStoredPreference`.** That hook defers
    the restored value by a tick so hydration is not disturbed, which is right
    for a mute and wrong here: every returning player would watch the strip
    appear and vanish on every load of the hub.
  - Every step's primary action goes somewhere real, and the free-puzzle count
    in its copy is **counted off `ARCADE_GAMES`**, not written down — same rule
    that catalogue states about prices and blurbs, which has been broken there
    three times. A test pins that the count reaches the sentence.
- Noted while verifying, not caused by this work: `multiplayer.spec.ts`'s
  six-player test and two `safe-area.spec.ts` table tests **fail identically
  at HEAD** in a detached worktree with none of the reskin present. The mobile
  quick-play test in the same file passes on both. Use the worktree trick
  (`git worktree add --detach`, `cp -al node_modules`) rather than `git stash`
  for a baseline here — the tree is shared with concurrent sessions. Note
  `/tmp` is a different filesystem, so the worktree has to live somewhere on
  the project's own device for the hard-link to work.
- **This is live on `www.stackchips.app` as of PR #16 (merge `fadd507`)** —
  verified against the Production deployment's own `success` status via
  `gh api repos/Nikkayowill/poker/deployments`, and against the live site
  serving what only this release contains: `/brand/stackchips-logo.png`
  returning 200 (it did not exist before), `sw.js` reporting
  `stackchips-shell-v6`, and the signed-out HTML carrying both
  `HIGH ROLLER ARCADE` and `#983fe0`. Not assumed from the merge alone.
- The admin console's borderless pass (`app/styles/14-admin.css`, commit
  `55de96a`) **is** on `main`, via PR #17. It was scoped *out* of PR #16
  deliberately and shipped anyway one merge later, which is worth
  understanding rather than tidying away: it was authored in this same
  working tree by a **concurrent Claude session**, committed at 01:10:55
  between #16's merge and #17's push, and #17 — a docs-only change — carried
  it because pushing a branch pushes every commit on it, not just the one
  you wrote. The lesson generalises past this repo: when more than one agent
  shares a checkout, `git log origin/main..HEAD` before opening a PR is the
  check that catches it; a clean `git status` says nothing about what is
  already committed on your branch.
- The supplied logo had **no alpha channel** — a solid black plate behind the
  art, which the user believed was transparent. `public/brand/stackchips-logo
  .png` is the fixed copy, made by flood-filling that plate from the four
  corners (`magick … -fill none -floodfill +0+0 black`, once per corner), not
  by keying out black globally: the banner's *interior* is genuinely black,
  so a global key punches holes straight through the wordmark. Regenerate it
  that way or not at all. `public/icons/icon-{192,512,512-maskable}.png` are
  rasterized from that file (maskable pads to a ~80% safe zone on `#0a0710`),
  and `public/sw.js` bumped to `stackchips-shell-v6` to force the new icons
  past an existing cache.
- Three sizes of the mark, and which one to use is a legibility decision, not
  a preference: `StackChipsLogo` (`components/brand/stackchips-logo.tsx`) is
  the full badge and belongs anywhere ≥96px — the sign-in card, the landing
  footer. `StackChipsMark` (`stackchips-mark.tsx`, same art as the rewritten
  `app/icon.svg`) is the arc + one card + one spade, for the ~44px header
  row, where the badge's own banner type measurably collapses into a smudge.
  The in-game header (`poker-table.tsx`) keeps its old `.mark` "S" diamond —
  it sits over the felt, which was out of scope. Same lesson as
  `components/arcade/dealer-avatar.tsx`: judge a mark at its rendered size.
- **Borderless is the chrome's rule now, and it has a consequence.** Every
  1px hairline box outside the table is gone; separation comes from a raised
  fill, a real shadow and space. Two categories were kept deliberately and
  are not oversights: *dividers between items* (the `or` rule in
  `.entry-divider`, `.arcade-row`/`.activity-item` row rules, panel
  header/footer rules) and *rings that are part of an avatar or swatch*
  (`.avatar-stage`, `.camera-button`, `.accent-row button`). The consequence
  to remember: several states used to be carried **by a border colour** —
  `.tier-card.selected`, `.cosmetic-card.is-equipped`,
  `.leaderboard-scope-active`, `.admin-filter-active`, the rarity tags,
  friend accept/decline hovers. Each of those was given a replacement signal
  (a filled brand wash, a ring via `box-shadow`, a tinted fill) rather than
  just having its border deleted; deleting one without replacing it makes the
  state invisible. Focus is `--brand-focus` everywhere, because removing
  borders makes a visible focus ring non-negotiable rather than optional.
- **The chrome sits in a matte-obsidian "room" now (2026-08-06 pass).** The
  base is neutral `#0a0a0b` (html/body and `--brand-ink` — no longer the
  violet `#0a0710`), textured by `--grain` (an SVG-turbulence data URI with
  its 0.05 opacity baked into the SVG so it can live in a background-image
  list) under two huge tokenised glows, `--glow-purple`/`--glow-gold`
  (01-tokens.css). The landing sections are card-less: separation is
  `--section-gap` (clamp 104–150px; 88px on phones — 12-responsive.css no
  longer collapses it), a `.landing-eyebrow` micro-label (10px, .25em
  tracking — same tracking as `.lobby-kicker` now) over a 400-weight serif
  display line, and open grids with wide gaps. Games/features/CTA/offer lost
  their fills; the CTA is a centred typographic close at every width. The
  sign-in card was deliberately left alone (user: "the login page looks
  decent"). Remaining chrome hairlines went: panel heading (darker band
  instead), modal header/footers, buyin/panel footnotes, arcade/friends/
  activity row dividers (spacing instead), leaderboard rows (zebra wash —
  a fill, not a rule). Landing CTA buttons, socials and the install strip
  are 2px-radius sharp; footer links hover a draw-in underline. Hub tiles
  and the lobby header were neutralised from green-black to obsidian; the
  Join Table tile alone stays green via its felt artwork/tint.
- **The mobile horizontal-pan leak is fixed, and its cause is worth
  remembering:** `.landing-game-grid`'s `minmax(420px, 1fr)` was a floor the
  track could not go under, so at 390px the grid outgrew the page and the
  whole landing panned sideways (`overflow-y: auto` computes the x-axis to
  auto too). Grid minimums in the chrome are `minmax(min(Npx, 100%), 1fr)`
  now, and `.lobby`/`.account-entry-page` carry `overflow-x: hidden`
  backstops. Verified by forcing `scrollLeft = 60` headlessly at 390px on
  both scrollers — it snaps to 0.
- **The chrome now runs all the way through the signed-in app** (PR #20,
  merge `f70f30a`, live and verified against the Production deployment's own
  `success` plus the live site serving `/favicon.ico` 200,
  `stackchips-shell-v7`, `theme-color: #0a0a0b` and a stylesheet containing
  `--brand-room`/`--lobby-header-h`/`.gold-badge-dot`). Six things:
  - `app/icon.svg` **was invalid XML** — a `--` inside a comment, which the
    house prose style uses everywhere and XML forbids. librsvg refused the
    file outright, and it is served as `image/svg+xml`, so the tab icon was
    very likely broken for everyone. Repaired, and the file now carries a
    note saying prose in it obeys XML rather than the house style.
    `public/favicon.ico` (16/32/48/64/128) and `app/apple-icon.png` — which
    was still the *old chip-stack art*, not the mark — are rasterized from
    it. ImageMagick's SVG delegate failing is a useful canary here: if it
    cannot read an SVG in this repo, browsers may not be able to either.
  - Scrollbars are hidden app-wide from one rule in `01-tokens.css` (`*` plus
    `*::-webkit-scrollbar`), generalising what `.friends-list`,
    `.arcade-list` and `.history-drawer` each did separately. Rendering only;
    a headless check pins the gutter at 0px while `scrollTop` still moves.
  - The navbar is coin + amount + avatar. `GoldBadge` is a readout now; the
    daily claim is a labelled row in the player menu (`Gift` icon,
    disabled-but-focusable via `aria-disabled` when already claimed) and is
    **not rendered at all for a guest** — the old "Save to claim" was a dead
    button advertising a signup the same menu already offers in words. The
    state machine is `lib/profile/daily-gold.ts` (`dailyGoldState` →
    ready/claimed/guest/unlimited, six tests), in `lib/` so `npm test`
    reaches it; `.gold-badge-dot` is the only indicator left.
  - **iOS PWA top inset.** `viewportFit: "cover"` + `black-translucent`
    means the web view starts at y=0, so the lobby header drew behind the
    clock and battery on an iPhone 14. `.lobby-header` takes
    `env(safe-area-inset-top)` as *extra height* (padding alone would crush
    its 82px contents under border-box), and `.lobby`/`.account-entry-page`
    subtract the same amount. New `--lobby-header-h` token is what keeps all
    three honest — the phone and both landscape breakpoints redefine one
    value instead of restating three literals, which 12-responsive.css used
    to warn about in a comment. `theme_color`/`background_color` and
    `viewport.themeColor` moved off the green-black `#09110f` to `#0a0a0b`.
  - The hub head wears the landing's pairing (`.lobby-kicker` at
    `#8d84a3` + `clamp(38px, 6vw, 64px)` serif) and the hero tile is
    **"Texas Hold'em"**, not "Join table" — the one tile in a five-game hub
    that never named its game. Status moved to the sub-line so the title
    cannot disappear while it loads. Its felt is an *object* bled off the
    right edge (`background-size: auto 78%`, 56% on a phone), not the card's
    background: tinting the old full-bleed green purple turned it teal, and
    a 2:1 plate sized by width gets its ends clipped off. Judge any change
    here on a render.
  - Collection and leaderboard stand in the room via `--brand-room`
    (01-tokens.css holds the whole five-layer stack as one value;
    `.lobby-hub::before` and the new `.collection-shell::before,
    .leaderboard-shell::before` in 02-app-shell.css both read it).
    `.cosmetic-card`'s plate and `.leaderboard-table`'s panel are gone — but
    note the *equipped* ring moved onto `.cosmetic-art-frame` rather than
    being deleted with the box it sat on, which is exactly what a
    "strip the boxes" pass silently loses. Friends' micro-labels were raised
    from 8px to the chrome's 10px/.25em.
- **Safe-area insets are a token, and that is the whole point** (PR #21, merge
  `5a1e2cd`, live and verified against the Production status *and* the live
  site relaid out under simulated insets: header 127px = 68 + 59, its content
  starting at y=71, header + page summing to exactly 844). `env(safe-area-
  inset-*)` is supplied by the browser and is **0 in every headless run**, so
  nothing about a notched layout could be asserted before it reached a real
  device — which is exactly how the lobby header got fixed for it while the
  in-game header did not, with no test able to tell. `--safe-top/-right/
  -bottom/-left` in 01-tokens.css default to `env()` and can be overridden;
  `tests/e2e/safe-area.spec.ts` sets them to an iPhone 14's real numbers
  (59/34 portrait, 59/59/21 landscape) and asserts nothing sits in a strip
  the OS owns and nothing overlaps anything it is not inside. **Write new
  inset-aware CSS against the tokens, never `env()` directly**, or it drops
  out of that coverage silently. Three real collisions it found:
  - The in-game header's contents moved down by the inset while its box
    stayed 68px, so the pot, blinds, Leave table and feed painted across the
    felt. The fix first went into `02-app-shell.css` and **did nothing**:
    `05-game-header.css` re-declares `height` and wins on load order. It is
    `calc(var(--game-header-h) + var(--safe-top))` there now, and
    `--chrome-height` derives from that same expression rather than being a
    second literal every breakpoint had to keep in step.
  - The same rule's `padding: 0 28px` shorthand was resetting the side-inset
    maxima the shared rule sets, so a landscape phone drew the wordmark and
    Leave table under the notch. A shorthand after a longhand is the recurring
    shape of both these bugs.
  - On a landscape phone `.table-feed` is an absolutely-placed corner overlay,
    which leaves `.blind-structure` as `.table-hud`'s only flex child — so
    `space-between` put it at the *start*, printed over the feed.
    `margin-left: auto` restores the two-ends band.
  `--table-reserve` counts both insets now: a standalone `100dvh` is the whole
  screen, indicator included, so the felt was sized as though the header and
  action bar had not each grown.
- **The phone hub is two columns.** Every small tile ran full width with its
  label bottom-left and art bottom-right — a 116px band mostly empty in the
  middle, five stacked. Two up with the art moved to the *top* corner (the
  desktop scrim fades left-to-right, which is the axis that stops existing at
  183px) fits the same content in 866px instead of 1145px. Spans mirror the
  desktop's so no cell is left over: hero 1/-1, arcade/friends/code full
  width, the four small tiles paired. Placement is DOM order, as at 1024px.
- Noted while testing, not fixed: the Adsterra script now tries to reach
  `spendsdetachment.com` over `connect-src` and is blocked by the CSP. That
  is the domain-drift `next.config.ts`'s Adsterra note predicted. It was left
  blocked deliberately — a beacon to an unrelated domain is the popunder/
  redirect behaviour that note warns about, and widening `connect-src` for it
  buys nothing the banner needs.
- The lobby install nudge (`components/install-prompt.tsx`) is a one-line
  `.install-strip` (13-status.css) fixed to the viewport's bottom edge —
  icon, one sentence ("Add StackChips to your Home Screen." + Install App
  on Chromium; "Tap Share then Add to Home Screen." on iOS), dismiss ×. It
  no longer reuses the `.save-progress-notice` shell; the cooldown/platform
  logic (useInstallOffer, 14-day dismissal) is unchanged. The landing's
  `install-cta` destination panel keeps its full steps but floats card-less
  on the page like every other section.
- The signed-out page is a real landing page now
  (`components/auth/landing-sections.tsx`): a PWA install panel first, then
  "The floor" — a game grid rendered **from `ARCADE_GAMES`** so it can never
  advertise a game whose route does not exist — then nine feature cards, the
  offer, the CTA and the footer. Hold'em is stated separately as
  `HEADLINE_GAME` rather than smuggled into that catalogue, because it has no
  single `entryCost` (buy-ins come off the `TIER_CONFIG` ladder) and no one
  `href`; putting it in the list would force it to lie about both. Icons are
  a `GAME_ICONS` lookup in the component, not a field on the catalogue —
  `lib/arcade/games.ts` is pure data reachable by `npm test` and must not
  drag lucide into the server-side wallet predicates.
- PWA install has **two surfaces with deliberately different rules**, sharing
  detection through `components/pwa/use-install-offer.ts` and pure,
  unit-tested platform logic in `lib/pwa/platform.ts` (14 cases). The lobby
  hub's `install-prompt.tsx` is a *nudge*: dismissible, 14-day cooldown, and
  silent on Android/desktop until Chromium actually fires
  `beforeinstallprompt`. The landing page's `pwa/install-cta.tsx` is a
  *destination*: it always renders the platform's real path, including the
  three manual taps, because waiting for that event would leave the page
  saying nothing about the app on the device class most likely to install it.
  `installPlatform` takes `maxTouchPoints` as a parameter specifically so an
  iPadOS 13+ device — which reports a desktop Safari UA string — is not told
  the desktop story; a test pins that a real Mac with the identical UA still
  reads as `other`.
- **Menu music plays now, and the sourcing question is closed** — the owner
  supplied seven of their own tracks, so `MENU_MUSIC_TRACK` is gone and
  `MENU_MUSIC_TRACKS` (a seven-entry playlist) replaced it. The licensing
  research it used to hold is condensed in that file's header and still
  applies to anything added later: Pixabay is where every stock file in
  `public/sounds/` came from and allows commercial use with no attribution;
  Kevin MacLeod/incompetech is **CC BY** despite being universally mislabelled
  free-of-attribution; FreePD, the best CC0 answer, shut down in 2025. Five
  things about the wiring worth not relearning:
  - **The assets landed months before the wiring did, and nothing noticed.**
    The tracks were committed and `MENU_MUSIC_TRACK` was still `null`, so the
    app shipped 40MB of music it could not play and no gate could see it —
    a manifest pointing at nothing is type-correct. If an asset is added,
    grep that some code names it before calling it done.
  - **One `<audio>` element for the whole playlist, `src` swapped on
    `ended`.** Autoplay permission is granted to an *element* that has already
    played, so a fresh element per track would have to earn it again and track
    two would be blocked on desktop Chrome. `loop` is true only for a
    single-track playlist: a looping element never fires `ended`, which would
    make track one the only one anybody ever heard.
  - `shuffleIndices` takes its randomness as an argument so a cycle can be
    proven to cover every track exactly once, and a reshuffle that would open
    on the track that just ended swaps it down one. Presentation is allowed to
    be random here — unlike `lib/scene` — but not untestable.
  - **Playing audio publishes a Media Session, and not setting one shipped the
    word "Untitled" to players.** A phone browser puts any playing `<audio>`
    into the OS media controls — Chrome's shade on Android, Control Center and
    the lock screen on iOS — and that surface cannot be suppressed. It prints
    `navigator.mediaSession.metadata`, falling back to the file's ID3 tags,
    falling back to the literal string `Untitled`; the loudnorm re-encode
    strips tags by design and nothing set a session, so both fallbacks were
    empty and the app labelled itself `Untitled` on every phone that played a
    note. `MENU_MUSIC_METADATA` (music-manifest.ts) is one identity for the
    whole playlist — the beds are genuinely untitled, so per-track names would
    be invented — with the PWA icons as artwork so the control matches the
    home-screen icon. The OS pause button is routed to `stopMenuMusic`, not
    left on the bare element: pausing behind the module's back leaves it
    believing it is still playing, and the next lobby render's idempotent
    `startMenuMusic()` then declines to resume. Every branch is
    feature-detected (absent on desktop Safari and in tests) and
    `setActionHandler` is wrapped, since older engines throw on an action they
    do not implement. **This is invisible to `npm test`, `lint` and `build`
    alike unless something asserts it** — five cases in `menu-music.test.ts`
    do now, and it was also confirmed live against a real Chrome reading
    `navigator.mediaSession.metadata` back.
  - **The tracks were re-encoded 256k → 128k with an EBU R128 pass, 40MB →
    20MB, and size was the smaller half of the reason.** Unnormalised they
    spanned 6.9dB, so shuffle stepped up and down in volume every few minutes;
    they span 3.0dB now. Masters are in gitignored `assets-src/audio-master/`.
    `MENU_MUSIC_GAIN` 0.35 against -18 LUFS puts the bed near -27, under every
    betting cue. `/sounds/` is **runtime**-cached by `sw.js`, not precached, so
    this never hits PWA install.
- **Three SFX stopped borrowing another effect's recording.** `your-turn` and
  `all-in` were each another file at a different gain — the same sound twice
  as loud rather than a different event — and `ui` shared the tap too. All
  three have their own recording now, and `TimeBank.mp3` gives `timeout` and
  `time-card` a file where they were silent by omission rather than by design
  (both are genuinely fired: a clock expiry and the time-bank control). Levels
  measured with `volumedetect` per that file's own rule. Two supplied files
  were deliberately **not** wired, and the reasons generalise: `win`'s
  alternatives run 10.2s and 3.9s against `NEXT_HAND_DELAY_MS` of 2,800, so
  either is still playing while the next hand deals — the stock 2.5s cheer is
  correctly sized and stays; and `Cards_Dealt.mp3` measures **-47.4dB**, 14dB
  under the `deal` target, which a gain that can only attenuate cannot reach.
  Six tests changed rather than being deleted — they pinned the borrowing as
  an invariant, so they are now what would catch it coming back. Note six of
  the supplied "new" SFX are **byte-identical renames** of existing stock
  files; checksum before assuming a new filename is new audio.
- **`feat/3d-table` is a second renderer, default-off, and the two share one
  e2e seam.** The branch reinstates `three`/`@react-three/fiber`/`drei` (so
  CLAUDE.md's "three.js is uninstalled" below is true of `main` and not of
  this branch) and puts an R3F room behind `DEFAULT_TABLE_RENDERER =
  "canvas_2d"` in `lib/scene/table-renderer.ts`, switchable from the table
  menu and hidden entirely where `useWebglSupport()` is false. Four things
  about the seam, which is the part built to make the room testable at all:
  - **`window.__stackchipsScene`'s shape is now `lib/scene/seam-contract.ts`,
    one exported interface, not a `declare global` in each renderer.** Both
    rooms answer the same ten methods in the same units, because the specs
    that check where a payout lands are about the *table*, not about how it
    is drawn. Two structurally-identical declarations would merge silently
    until they drifted, and the failure then is a spec asserting something
    different depending on a preference flag; a renderer that stops matching
    now fails to compile.
  - **Two of the ten stopped being derivable and are measured instead.**
    `roomScale` and `roomFelt` were coined under orthography, where a world
    unit is the same number of pixels everywhere and `projection.ts` solved
    the fit in closed form. A perspective camera has no such number, and the
    felt is not an ellipse on screen once projected — its near edge is wider
    than its far. So `roomScale` reads the scale *across the felt's centre*
    and the contract says it means nothing elsewhere; `roomFelt` samples the
    rim, projects every sample and reports the bounding box. Verified live at
    1440×900: 199 px/unit, felt 864×398 against 4.3 world units of width
    (856 px predicted — the excess is the near edge, which is the point), and
    seats landing perfectly symmetric about x=720.
  - **`awake()` is pending work, never recent paint, and that was learned the
    expensive way.** The first cut inferred it from how recently a frame had
    drawn — a 50 ms window, three frames at 60 Hz. Driven headlessly the room
    renders about **two frames a second** (a shadow-mapped scene under
    SwiftShader is ~450 ms a frame), so a room with eight chips visibly in
    the air reported itself asleep across 1,141 consecutive samples. Frame
    recency cannot separate "nothing left to draw" from "still drawing,
    slowly", and a window wide enough for software rendering is far too wide
    to prove a loop settled. It reads `animating` from the registry now,
    published from the very flag that keeps the demand loop alive, which is
    also what the 2D room's `isAwake(scheduler)` has always meant.
    `framesRendered()` stays the independent evidence the loop really stopped.
  - **`near-seat-bet.spec.ts` and two of `chip-flights.spec.ts` fail on this
    branch already — do not read them as seam regressions.** All five time out
    at 120s rather than failing an assertion, and the page snapshot shows the
    table reached and seated with the pot at 15 (blinds only): the hand never
    progresses, so `.community-card-shell` never exists and the locator
    waiting for it hangs. **Confirmed by running the same spec in a detached
    worktree at HEAD** — identical failure with none of the seam work and none
    of a concurrent session's in-flight route changes present. That worktree
    trick is the safe way to get a baseline when the tree is shared: `git
    stash` would have yanked the other session's uncommitted work out from
    under them, which is the same hazard as `commit -a` here. Note Next
    rejects a `node_modules` symlink pointing outside the project root, so
    hard-link it (`cp -al`, ~2s) rather than symlinking.
  - **`lib/game3d/scene-registry.ts` exists because the chips are invisible to
    React.** `chip-instanced-layer.tsx` writes InstancedMesh matrices straight
    from a per-frame pass — deliberately, since pushing sixty matrix updates a
    second through the reconciler is what that file exists to avoid — so
    nothing a seam component could read holds a chip's position. The writer
    publishes world-space poses there and the seam projects them; keeping
    projection out of the registry is what lets it stay three-free and so
    reachable by `npm test`. `POT_PILE_KEY` is exported for the same class of
    reason: `pileSize()` counts that pile by name, and two copies of the
    string `"pile-pot"` agreeing only by luck would have it report zero.
- The table renderer is a **Canvas 2D room** now — the three.js/WebGL room
  that briefly replaced the CSS chip system was itself replaced at the
  user's explicit request (they preferred the Canvas 2.5D look prototyped in
  session; the full WebGL implementation is preserved on the
  `archive/webgl-room` branch, restorable via
  `git checkout archive/webgl-room -- <path>` — do not resurrect it without
  an explicit instruction). The old CSS chip system
  (`.pot-pile-chip`/`components/table/pot-pile.tsx`) stays gone. Current
  architecture: `lib/scene/` is pure, deterministic logic — an orthographic
  tilt projection (`projection.ts`: one TILT_DEG angle derives sin/cos
  coefficients; the fit is closed-form, no solver — see the fit bullet
  below), seat-ring math, chip friction-slide physics
  (`chip-physics.ts`, unchanged from the WebGL era, including value-based
  sprays: bets fly the committed delta's denomination breakdown, each
  winner's funnel flies their own `Winner.amount`, capped at
  `FUNNEL_CHIP_COUNT` so the `NEXT_HAND_DELAY_MS` budget proof holds), the
  dirty-flag render scheduler, and `chip-layer.ts` — the whole chip state
  machine (keyed pile sync, sprays, lifecycle), now pure and unit-tested
  (66 lib/scene Vitest cases). `components/table/scene/` is just
  `table-scene.tsx` (canvas mount, scheduler loop, DPI capped at
  MAX_PIXEL_RATIO, the `window.__stackchipsScene` e2e seam with the same
  API the WebGL room exposed) and `paint.ts` (carpet/rail/felt/chip
  painting from `CHIP_PALETTE` — the palette has now survived two renderer
  changes). The DOM HUD is *unchanged and primary*: `.seat-figure` avatars,
  nameplates, cards, action bar, feed, sounds all render exactly as before
  the WebGL era — the sprite avatar layer, `webglAvatars` flag,
  `onSeatProjection` seat-ring override, and `.scene-avatars` CSS are all
  gone; the CSS ellipse in `lib/game/table-geometry.ts` is the one layout
  authority again, and the canvas fits its painted table inside it.
  `.scene-lit` still gates the DOM felt yielding on `onReady`. three.js and
  @types/three are uninstalled (~350KB gzip gone; no more code-split chunk
  needed for the renderer, though the dynamic import stays). Porting
  exposed a real latent WebGL-era bug, now fixed and pinned by a regression
  test: `update()` fed the arc-inflated *drawn* position back into
  `stepChip`, so the arc residue re-amplified near the target and spray
  chips never actually arrived — they hovered, holding the render loop
  awake; the slide's `base` is now the motion state and the arc is applied
  only to the drawn position. `tests/e2e/table-scene.spec.ts` was rewritten
  for the canvas contract (HUD hit-testing, felt-yield + DOM-figures-
  primary, closed-form fit asserted exactly on desktop and portrait-phone
  viewports, and a loop-sleeps test the WebGL room could never have passed);
  `chip-flights.spec.ts` runs unchanged against the preserved seam.
- **The room fits `.poker-rail`'s measured box, and the table's plan shape is
  solved per fit.** The first Canvas cut pinned the felt to
  `.poker-table-wrap`'s *width* alone and carried a fixed `radiusX:radiusZ`,
  which paints one wide horizontal oval at every size — but `--table-aspect`
  is 1.84 on a desktop, **0.62 on a portrait phone** and 3–3.6 in landscape.
  On a phone that put a flat pancake across a tall plate with the seat ring
  looping far above and below it, and on a desktop it painted the felt
  *wider* than the ring (1180px of felt against a 1086px ring), so the
  figures read as sitting on the cloth rather than at its edge. Both were the
  same bug. `fitView` now takes the **rail's** box — `.poker-rail` carries
  the per-breakpoint insets the artwork was cut to (`15% 4% 8%` desktop,
  `9% 7%` phone) and is the geometry `lib/game/table-geometry.ts`'s ring was
  hand-tuned against — and solves both radii so the painted `RAIL_SCALE`
  ellipse fills it: `scale = (railW/2/RAIL_SCALE)/radiusX`, then
  `radiusZ = (railH/2/RAIL_SCALE)/(TILT_SIN·scale)`. `SceneView` carries that
  `radiusZ`; `seat-ring.ts` and `ChipLayer` (via `setRadiusZ`) take it so the
  ring, bet spots and pot all follow the plate together. Deliberately *not*
  done as a depth multiplier inside `project()` — that stretches everything
  on the ground plane including each chip's own face, and a chip is a chip at
  every breakpoint; elongating the table instead leaves discs round. Measured
  after: desktop felt 954×407 inside a 1087×464 rail with seats at radial
  0.94–1.26, portrait felt 291×419 (**tall**), landscape 558×150.
- The pot is no longer at the felt's centre — `potPosition(radiusZ)` puts it
  `POT_DEPTH_FRACTION` (0.55) of the felt's depth **away from the viewer**.
  `.community-cards` lies across the middle (`top: 51%`, 47% on a phone), so
  a centred pot was chips stacked on the flop with each hiding the other.
  Behind the board rather than in front of it is an invariant, not a
  preference: the near half of the felt belongs to the local player's own
  figure (`SEAT_HEIGHT_RATIO` 0.30) and their hole cards — a pot pushed
  toward the viewer landed behind that player's own head, measured 11px below
  the board's bottom edge at 1440×900. It is also where this app has always
  said the pot lives (`--deck-y: 26%`). Known limit, documented in the
  constant: a **landscape phone** has no clearance to find at all — the board
  is 108px tall inside a 150px felt — so the pot still overlaps there; that
  is a board-size problem, not a pot-position one.
- `card-backs.spec.ts` ("every seat deals from its own deck") and
  `dealing.spec.ts` ("the local player is dealt first…") **fail on `main` as
  of `7f15bd9`, before any of the above** — both time out waiting for
  `.own-cards .dealt-card-shell` to reach 2. Confirmed by stashing and
  re-running against a pristine tree, so do not read them as a regression
  from the fit work; they are an open pre-existing failure.
- **Bet animation is selectable — "neat_slide" vs. "splash_chunk" — and the
  chip painter is a layered pipeline now.** `lib/scene/bet-style.ts` (pure,
  unit-tested) holds the style type, `stackchips:bet-style` localStorage key,
  normalize/cycle helpers, and the splash scatter math: landing offsets are
  the trigonometric index wave `sin(index)/cos(index)` (never
  `Math.random()` — same determinism contract as `chipSettleJitter`), left
  deliberately *round* in plan space because the spec's 0.62 depth squash
  ≈ `TILT_SIN` and `project()` already applies it; a test guards against
  re-adding it (double compression). Splash is the default (continuity with
  the old spray) and flies staggered friction slides on a taller
  `SPLASH_ARC_PEAK` parabola; neat slide flies the whole bet as one rigid
  pillar (stacked by `CHIP_THICKNESS`, no stagger, no arc) on a clocked
  cubic-ease-out (`stepGlideChip`, `NEAT_SLIDE_DURATION_MS` 520 < the 900ms
  flight-event window — a test pins that) which *terminates exactly*, so
  the render loop always sleeps — the friction slide's asymptote never ends
  a frame early, a glide must not end one late. The preference lives in
  `poker-app.tsx` exactly like sound/music (deferred-set localStorage
  idiom), cycles from a "Chip style: …" entry in the table menu, and
  reaches `ChipLayer.setBetStyle` via a `TableScene` prop; in-flight chips
  keep the trajectory they left on. `paintChip` (`paint.ts`) now draws rim
  (3-stop bevel gradient via `shadeHex`, which derives lit/shaded steps
  from the palette's one base colour), eight true angular-sector edge
  inserts clipped to the rim ring, a stamped inlay (clipped
  `ctx.shadowBlur` inset shadow), and the denomination in foreshortened
  serif print — gated at `NUMERAL_MIN_RADIUS` 8px so a phone-scale chip
  (rx ≈ 6.6) stays clean rather than smudged (the dealer-avatar lesson).
  The airborne ground shadow is decoupled: radial-gradient pool (not
  `ctx.filter: blur`, which forces an intermediate layer per chip) that
  shrinks and softens with arc height. Verified: 727 unit tests, the
  chip-flights + table-scene e2e specs (including loop-sleeps), and a live
  headless run screenshotting both styles and the menu toggle round-trip.
- **Stacked chips no longer read as floating.** The stack pitch itself was
  always flush (rest `y = FELT.y + T/2 + i·T`, faces painted at `y ± T/2`) —
  the floating look had two other causes, both fixed. (1) `paintChip`'s
  airborne ground shadow gated on height alone (`> CHIP_THICKNESS`), which
  every resting chip above a column's bottom one trips, so a settled pile
  painted hovering shadow pools over its own lower chips; `SceneChip` now
  carries an `airborne` flag (set on every flight push, cleared on arrival,
  re-armed by `sweepBets`) and the painter keys the shadow off it. (2)
  `chipSettleJitter`'s z step was ±0.09 world ≈ 90% of a screen pitch, so
  column neighbours could sit almost two pitches apart; the axes are now
  unequal (x ±0.06, z ±0.024) and a test pins the invariant that a column's
  whole depth range × TILT_SIN stays under one pitch × TILT_COS.
  `CHIP_THICKNESS` also snapped 0.08 → 0.068 (real 39mm×3.3mm proportions,
  thickness = radius × 0.17), so stacks read denser at the smaller radius.
- **The local player's bet spot has its own inset.** Slot 0 is the only chair
  whose `.seat-figure` is drawn out over the cloth, so at the ordinary
  `BET_INSET` 0.74 the local player's avatar (DOM, z-index 4+) painted over
  their own bet (canvas, z-index 0) — they were the one player who couldn't
  see their chips go out. `seatBetOrigin` gives slot 0 `NEAR_SEAT_BET_INSET`
  0.35: the midpoint of the *measured* desktop corridor between the board's
  bottom card (y=527 at 1440×900) and the figure's crown (y=549), which in
  inset units is only [0.315, 0.388]. Beware the calibration trap that cost
  a first cut at 0.30 (landed behind the board): `orderedSeats` rotates the
  local player to DOM index 0, so measuring "the near figure" with
  `.seat-figure").last()` measures the *far* seat — use
  `.player-seat.seat-mine`. `tests/e2e/near-seat-bet.spec.ts` pins the fix
  against rendered DOM boxes via a new `betSpot` seam on
  `window.__stackchipsScene`, in two regimes: desktop/portrait assert real
  clearance both ways; a landscape phone has no corridor at all (the board's
  box ends 35px *below* the figure's top — same plate-depth limit
  `POT_DEPTH_FRACTION` documents), so there the spec asserts the relative
  guarantee (crown-height, not chest-height) instead.
- Standing street bets: a seat's committed-this-street chips now *rest in
  front of the bettor* (`ChipLayer.syncBets`, keyed `slot:denom:index`,
  columns spread along the seat's ellipse tangent so side-seat bets stay on
  the felt) and sweep into the middle when the street turns
  (`sweepBets` — the chips are transferred into flight from where they
  rested, not respawned; an all-in runout that jumps streets sweeps once).
  The centre pile renders `pot − Σ streetBet` so the felt's chips always
  sum to the pot the HUD states — a unit test pins that invariant. Bet
  sprays now land on the bettor's own spot (rail → bet spot), not the pot.
  Hand boundaries and payouts `clearBets` instantly instead of sweeping;
  the hand-boundary clear lives in the street effect in `table-scene.tsx`,
  deliberately *before* the sync effect in declaration order — a trailing
  new-hand effect would clear the incoming blinds' just-synced piles on the
  same commit. `streetBets`/`street` are new `TableScene` props fed from
  `seat.streetBet`/`game.street`.
- Manifest (`app/manifest.ts`) now locks `orientation: "portrait-primary"`
  and ships real icons: `public/icons/icon-192.png` / `icon-512.png` /
  `icon-512-maskable.png`, rasterized from the existing `app/icon.svg` mark
  via ImageMagick (the maskable variant pads the same art to an ~80% safe
  zone on a solid background rather than reusing the flat SVG, which Android
  would otherwise center-crop). `public/sw.js` bumped to
  `stackchips-shell-v5` to precache them. New `components/install-prompt.tsx`
  captures `beforeinstallprompt` for Android/desktop Chrome and shows an
  instructional "Share → Add to Home Screen" variant on iOS Safari (which
  never fires that event); it reuses the existing `.save-progress-notice`
  shell from `components/lobby/lobby.tsx` verbatim rather than inventing a
  new banner style, and its own dismissal persists to `localStorage` with a
  14-day cooldown, not permanently. Mounted in the lobby hub, gated on
  `entryComplete && profile && !game`.
- Mobile safe-area audit found the app shell/action-bar/header already
  handled `env(safe-area-inset-*)` correctly everywhere except one shared
  shell: `.history-drawer` (`app/styles/10-notices.css`, reused verbatim by
  `.friends-drawer`) had zero inset handling on any side, in either its
  desktop right-slide-in form or its mobile bottom-sheet override
  (`app/styles/12-responsive.css`). Fixed following the codebase's own
  `max(Npx, env(...))` idiom — right/top insets on the side-drawer form,
  left inset + a 16px-floored bottom inset on the bottom-sheet form (whose
  `padding-top` is explicitly zeroed since that form no longer touches the
  top edge). Verified against actual computed styles via a headless
  Playwright check, not just by reading the CSS.
- Menu music: `lib/audio/music-manifest.ts` + `lib/audio/menu-music.ts` mirror
  the existing SFX architecture (`lib/audio/manifest.ts` + `sound-effects.ts`)
  — cached `<audio>`, fade in/out, autoplay-blocked retry on the next gesture
  — and now carry a real seven-track playlist; see the menu-music bullet
  further up for the playlist/encoding decisions. An empty
  `MENU_MUSIC_TRACKS` is still the silent-by-design path, the same convention
  `lose` uses in the SFX manifest. Wired into `poker-app.tsx` exactly like the
  existing `soundEnabled`/`toggleSound`/`SOUND_STORAGE_KEY` block (new
  `musicEnabled`/`toggleMenuMusic`/`MUSIC_STORAGE_KEY`, a "Menu music: On/Off"
  entry in `lobbyMenuItems`), started/stopped on the one screen boundary
  that actually exists in this app: `!game` (lobby/hub) vs. `game` truthy
  (seated at a table, hand or no hand in progress).
- UI polish pass: the repeated flat 2-stop `linear-gradient(180deg, …)`
  button fills across `app/styles/09-action-bar.css` (fold/check/call/raise/
  primary, all six action buttons) and the gold CTAs in
  `app/styles/04-lobby.css` (`.primary-action`, `.account-primary-action`,
  `.landing-cta-primary`) were the clearest "generic template" tell — same
  flat fade repeated on every button with no differentiation. Replaced with
  a shared 3-stop, steeper-angle treatment (a lighter highlight stop near
  the top) plus a thin inset top highlight on `.action-slot-controls
  button`'s base box-shadow, so buttons read as an enameled/beveled surface
  rather than a CSS-101 gradient swatch. Deliberately did not touch
  `05-game-header.css`'s felt-lighting radial-gradients (already
  hand-tuned, per that file's own comment about avoiding banding on real
  devices) or the green/gold palette itself, per prior guidance on this
  project.
- The Adsterra CSP block (`app/layout.tsx`'s hardcoded ad script against
  `next.config.ts`'s CSP, previously flagged and left unfixed) is now fixed:
  `next.config.ts` adds `https://*.effectivecpmnetwork.com` to `script-src`
  (the loader) and a new `frame-src` directive (the ad unit itself renders in
  an iframe per its `format: 'iframe'` config, and CSP's `frame-src` falls
  back to `default-src 'self'` when absent, which was blocking the iframe
  independently of the script). Wildcarded on the subdomain rather than
  pinned to `pl30614360...` because Adsterra serves creative from other
  subdomains of the same registrable domain, not a fixed host. Worth noting
  for whoever picks this back up: Adsterra is a known-aggressive ad network
  (popunders/redirect creative are common complaints against it), and CSP
  only constrains where a resource can load *from* — it doesn't vet what
  that resource does once loaded. If the ad unit still doesn't render fully
  live, or renders something that looks like a redirect/popunder rather than
  a banner, the next domains to check are `img-src`/`connect-src`, not
  `script-src`/`frame-src` again.
- `GoldBadge` (`components/profile/gold-badge.tsx`, the navbar balance) no
  longer prefixes the number with a `"Gold: "` label — just the coin icon and
  the amount (or `Unlimited`). `.gold-balance` is a flex row with `gap: 4px`
  between children, so dropping the label span needed no CSS change. The
  `.gold-badge` pill's own border is gone too (`app/styles/02-app-shell.css`)
  — background/padding/radius stay, just no outline around it.
- A departed bot's seat no longer vanishes or resets on the spot — it was
  already almost true at the data layer (`reseat()` in engine.ts is the
  *only* place a departed bot's identity gets overwritten; a voluntary leave
  only ever touches `status`/`stack`/`reseatEligibleAt`, per that field's own
  comment on `Seat` in `lib/game/types.ts`), so this was a client-rendering
  gap, not an engine change. `lib/game/seat-presence.ts` exports
  `isBotAway(seat)` — `status === "out" && reseatEligibleAt !== null`, the
  one signal that tells a bot's voluntary departure apart from every other
  `"out"` seat (a busted human's rebuy grace, a seat claimed mid-hand).
  `components/table/player-seat.tsx` uses it for a `.seat-away` class (fuller
  grayscale + dimmer than an ordinary `.seat-muted` fold, in
  `app/styles/08-seat.css`) and swaps the stack row's chip count — which
  would otherwise misleadingly read "0" — for a fixed "Sitting out" label.
  That label is intentionally not the old removed status-pill pattern:
  `table-feed.spec.ts` asserts no seat prints a `.status-pill`/`.action-pill`
  (variable-length prose that clipped under the table), and this is a
  different class, a constant string, sitting in the stack row's existing box
  rather than a new floating element, so it can't reproduce that bug. Pure
  logic lives in `lib/game` rather than on the component specifically so it's
  reachable by `npm test` — `vitest.config.ts`'s `include` only covers `lib/`
  and `app/`, so nothing under `components/` runs today, which is also why
  there's no React/RTL test here, only the six-case unit test on `isBotAway`
  itself. Verified live, not just by reading the CSS: a memory-mode dev
  server with `RIVER_BOT_LEAVE_CHANCE=1` forced multiple bots away in one
  hand, and a Playwright check confirmed the grayscale/opacity/label on the
  rendered seats and screenshotted the result.
- The hub grid is four columns on desktop (`≥1024px`) and no longer leaves a
  hole. The hole was arithmetic, not styling: at the old two-column cap the
  small tiles were private/gold/collection/leaderboard/friends — five items in
  a two-wide grid, so the last row held one tile and one empty cell, and
  simply widening to four would have moved the hole rather than closed it. A
  new fourth panel (`components/lobby/arcade-panel.tsx`, "Arcade & Puzzles")
  plus explicit spans is what makes every cell land: arcade takes a 2×2 block,
  friends and the room-code form take two columns each, and `.hub-tile-wide`
  keeps its existing `1 / -1`. `.hub-tile-code`'s base `1 / -1` is
  deliberately narrowed at that breakpoint — full width there would strand the
  two cells beside friends. **Placement is by DOM order**, so the panel is
  rendered between Buy Gold and Collection in `lobby.tsx`; moving it in the
  source reopens the hole. Verified against real computed rects at
  1440/820/390 via headless Playwright, not by reading the CSS.
- The arcade panel is a `.hub-tile` (same border/radius/16px padding/hover as
  every other panel) with a scrolling list inside, the same way
  `.friends-drawer` reuses `.history-drawer`; `app/styles/22-arcade.css` holds
  only list rules and is imported last in `app/globals.css`. `.arcade-list`
  needs `min-height: 0` — a flex item's `min-height` is `auto`, so without it
  the ten rows refused to shrink, the panel grew to 509px and dragged every
  tile sharing its grid rows to 290px. The `max-height: 230px` cap is
  deliberately not a whole number of rows: the half-cut fifth row is the only
  "there is more here" affordance, since the scrollbar is hidden (same
  reasoning as `.friends-list`).
- **Blackjack 21 is the first live arcade game** (`lib/arcade/blackjack.ts`,
  `/games/blackjack` via `app/(lobby)/games/blackjack/page.tsx` — `(lobby)` is
  a route group, so the parens are not a path segment). The engine is pure and
  synchronous like `lib/game/engine.ts`: every function takes a round and
  returns the next one, which is what makes the whole rule set reachable from
  `npm test` (37 cases) and what would let a server route own a round later
  without rewriting any of it. House rules: one deck reshuffled per round,
  dealer **stands on soft 17** (`total < DEALER_STANDS_ON`, one expression
  covering hard and soft), naturals pay 3:2 and two naturals push, double down
  on the opening two cards only, no split/insurance/surrender. `handTotal`
  counts aces down from all-elevens so A-A-9 lands on 21 rather than 12 or 31.
  `dealerUpCards` is what the view renders from, so the hole card is genuinely
  absent from client state until the dealer's turn rather than merely hidden.
- **Blackjack now settles against real Gold, and the server owns the deck**,
  and it is live on `www.stackchips.app` via PR #7 (merge `3a8d4bf`) along
  with the arcade hub panel and the four-column grid.
  The client no longer deals: `app/api/arcade/blackjack` (GET resume, POST
  deal) and `.../blackjack/actions` (POST hit/stand/double) hold the round,
  and `components/arcade/blackjack-table.tsx` replaces its one snapshot with
  whatever the API returns. The engine was already written for this and did
  not change shape — `dealRound` takes `RandomInt`, so the route hands it
  `node:crypto`'s `randomInt`.
- Three ordering rules are the entire safety argument for that route, and
  they are restated at the top of `lib/server/blackjack-service.ts` because
  breaking any one of them is a silent money bug: (1) the stake is debited
  *before* the round exists, and a deal that fails to persist refunds — the
  reverse order deals a hand nobody paid for; (2) a payout is credited only
  after the version-guarded write that settles the round is confirmed;
  (3) because the stake already left the wallet, settlement is a single
  credit of `stake + netGold` (`settlementPayout`) rather than a second debit
  on a loss — a loss returns 0, a push the stake, a win twice it.
- `blackjack_rounds.version` is the settlement idempotency key, not just a
  concurrency guard. `advanceBlackjackRound` is an `UPDATE ... where version =
  <what the client last saw> and status = 'active'` and returns **null** on a
  lost race; null must never pay out. That is what makes a double-clicked
  Stand, a retried request or two tabs settle exactly once. Verified live
  against a memory-mode dev server, not just by unit test: 15/15 three-way
  simultaneous settles accepted exactly one and credited exactly one payout,
  and 10/10 three-way simultaneous deals charged exactly one stake. (When
  racing that server by hand, establish the session cookie with a GET first —
  concurrent cookieless requests each mint their own profile via
  `readOrCreateSessionToken`, which looks exactly like a broken guard.)
- **The Supabase branch of `blackjack-store.ts` has not been exercised
  against a real round.** Everything verified so far — the 569-test suite,
  the concurrency races, the browser run — went through the *memory* branch,
  because `npm test` and a no-env dev server both take that path. The
  Supabase branch (the PostgREST version-guarded `UPDATE`, the `23505` catch
  behind `ActiveBlackjackRoundExists`, `jsonb` round-tripping the round) has
  only ever been type-checked. What is confirmed in production is that the
  table exists with the right grants and that the routes respond; the first
  real hand played there is still the first execution of that code. Watch for
  it, and note the version guard is the piece whose failure mode is silent
  and expensive: if the PostgREST `.eq("version", …)` filter did not behave
  as an atomic compare-and-set, a double-settle would pay twice rather than
  erroring.
- The orchestration lives in `lib/server/blackjack-service.ts` rather than in
  the handlers for the reason `lib/arcade/games.ts` and
  `lib/game/seat-presence.ts` exist: `vitest.config.ts` collects only `lib/`
  and `app/`. `toBlackjackErrorResponse` is in there too and returns a
  `NextResponse` — every other file under `app/api` is a `route.ts`, and
  `lib/server/api-auth.ts` already established that a `lib/server` module may
  hand one back.
- The service tests deliberately do **not** stack a deck: a seam to override
  the route's randomness is a seam an attacker would want. They assert the
  invariant `final balance === starting balance + netGold`, which has to hold
  across wins, losses, pushes, naturals and busts alike; the per-outcome
  payout arithmetic is pinned separately on `settlementPayout` in
  `lib/arcade/blackjack.test.ts`.
- A live round is resumed, never re-dealt. A refresh, a back-button or a
  second tab hitting POST gets `resumed: true` and the existing round back
  untouched — dealing again would debit twice for one hand. One live round
  per profile is enforced by a partial unique index (and the equivalent check
  in the memory branch), caught from the `23505` rather than by a
  check-then-insert, since two concurrent deals both pass a read-first check
  after each has already taken a stake.
- `toBlackjackSnapshot` is the redaction boundary, and it is a real one: the
  payload has no `deck` field at all (a test asserts `"deck" in snapshot` is
  false, not merely that it is empty) and `dealerHand` is `dealerUpCards`, so
  the hole card is absent from the wire until the dealer's turn rather than
  merely unrendered. `canCoverStake` stays a pure display predicate — it
  decides which stake buttons appear; `spendGold` is the authority.
- **Cosmetics now travel to the arcade.** Blackjack was carrying neither slot:
  the face-down card called `<PlayingCard card={null} large />` with no `back`
  prop, so it drew the house deck no matter what the player had equipped — the
  exact defect `PlayingCard`'s `back` prop was added to fix at the poker table
  — and no avatar was rendered at all. Both slots of `EquippedCosmetics` are
  wired now: `back={profile?.equipped.cardBack}` on the hole card, and
  `<ProfileAvatar profile={{ ...profile, avatarCosmetic: profile.equipped.avatar }} />`
  beside the player's hand, which is the identical call `poker-table.tsx`
  makes. The player's hand is labelled with their `displayName`, not "You" —
  a generic label beside a face they chose reads as somebody else's seat.
  Verified by buying and equipping a *non-default* pair on a live dev server
  and reading the rendered result, not by assuming defaults prove the path:
  the face-down card's base fill went `#1d4636` (house) → `#5a1f22` (oxblood)
  and the avatar resolved to `/avatars/avatar-grinder-face.webp`.
- **The house dealers are Loki and Finn, two dogs, and the room is a stack of
  flat 2D layers — the three.js stage that briefly rendered them is gone.**
  They replaced Vera, a single human croupier, at the user's request. The
  feature is deliberately silly and deliberately built like a serious one.
  Five things to know:
  - **The pair are real art now, and they stand BEHIND the cloth.**
    `public/dealer/{loki,finn}.webp` are the card-holding portraits cut from the
    owner's reference sheet (a 4×2 grid of eight poses; only this one is cut —
    the other six are still on the sheet). Three things about it:
    - **Cut by corner flood-fill, never a global black key.** The sheet is drawn
      on a solid black plate and Finn is a black dog in a black waistcoat and a
      black bow tie, so a global key punches through all three — the same trap
      `public/brand/stackchips-logo.png` hit. The safe fuzz was *measured*, not
      guessed: above ~3% the fill starts eating his tie and eyes (his opaque
      fraction collapses 0.52 → 0.20 by 20%). Both cuts were checked for
      interior holes and composited over a *light* background, where a black
      fringe would show. Recut them that way or not at all.
    - **They are behind `.bj-surface`, not in front of it.** The layer order was
      inverted so the paws could drape over the rail, which was right for a flat
      CSS crop and wrong for photographic art: nothing in the room ever passed
      in front of them, and an object no other object occludes has no depth. The
      cloth crosses them at the rail now, they are ~35% smaller, and
      `.bj-dealer` carries a `mask-image` that dissolves the lower body through
      the band *above* the rail — tune those stops against how deep the pair are
      sunk, or the fade happens where nobody can see it. `brightness` below ~.85
      turns Finn into a silhouette with two eyes, which is the trap his coat
      colour exists to avoid.
    - **`.bj-dealer`'s size caps were circular and silently broken.** Its
      `max-width`/`max-height` are percentages of `.bj-dealer-pair`, which was
      shrink-to-fit on both axes — so each cap was a fraction of a box that cap
      determined. It settled at 362×280 with the images pinned by `max-width:
      30%` of the 362 they produced, and asking for a *smaller* percentage made
      them smaller twice over. The pair fills the row on both axes now. Any
      percentage cap in this file wants a definite parent.
    - The four expressions are still declared and `dealerExpression()` is still
      total, but with one portrait per dog the pair **hold one face** through a
      win and a bust alike. `DOG_PORTRAIT` is the fallback; dropping
      `loki-cheer.webp` in and adding its `DOG_ART` entry is the whole step.
    - **The uniform drift is fixed, and removing the visor broke two other
      things on the way out.** `DogUniform` was a green croupier's visor and a
      *gold* bow tie; the art has neither, and since `dealer-avatar.tsx` renders
      live in **five other arcade games** (video poker, roulette, coin flip,
      baccarat, hi-lo) the wrong uniform was on screen everywhere except the one
      page anyone was looking at — Blackjack, where this SVG is only the
      *placeholder* and stops rendering the moment real art lands. That is the
      general hazard: a placeholder's bugs are invisible exactly where the real
      thing works. It is `shirt`/`waistcoat`/`tie` now (`#d6bda3`/`#1b1611`/
      `#14100c`), **sampled from the portraits with ImageMagick**, not chosen.
      Three things the redraw settled:
      - **The tie needs the collar.** Gold on the dark green disc needed no
        help; near-black does. The ivory collar behind it is load-bearing, not
        trim — `dealer.test.ts` pins the brightness gap so a later
        "simplification" cannot quietly delete it.
      - **Both fringes were only ever legible under a visor.** Each dog's crown
        band protruded *above* its own skull, so with the visor gone it read as
        headwear sitting on a dog — a bowler on Finn, a beret on Loki. Loki's
        was fixed by geometry (bring it inside the outline; apricot has
        somewhere darker to go, so a dark fringe still reads as curl). **Finn's
        could not be**: his coat is deliberately just off black, so there is no
        darker value left to shade with, and any dark mass on that skull stops
        being shading and becomes an object. His curls are picked out in
        *light* now, the same trick his ear rim already used. Do not "make the
        two consistent" — the asymmetry is the point.
      - Judge it at 34px. That is the size it actually renders in all five
        games, and the hats were invisible there while being obvious at 400.
  - **The coats are Loki apricot `#d99b5c` and Finn black `#332e30`**, from the
    owner's own reference sheet. An earlier pass had Loki as a blue-merle with
    blue eyes and Finn as a tall golden — both wrong, and wrong in a way no
    test can catch, because a coat colour is only checkable against the animal.
    Do not retune these by eye against a render; check them against a
    photograph. Finn's `base` is deliberately not `#000`: a true black coat has
    no silhouette against an almost-black page, so what reads as "black dog" is
    a very dark warm grey with the curls picked out lighter.
  - **`lib/arcade/dealer.ts` is the single authority on who they are** — names,
    breeds, coats, uniform, and `TIP_LINE`. It absorbed the deleted
    `dealer-rig.ts`, so there is **one** `DEALER_DOGS` and not two. That
    matters more than it sounds: for a while both existed with *different*
    palettes, and the pair that actually rendered read the wrong one. Two
    drawings of the same two dogs disagreeing about their colour is the exact
    drift a shared constant exists to prevent.
  - **`three` is not a dependency.** It was added for the WebGL stage and
    removed with it; `package.json` is back to where it was. The Canvas 2D
    poker room was never touched and must stay that way — do not read any of
    this as permission to bring WebGL back to the felt.
  - **`lib/arcade/dealer-scene.ts` is the layer contract**, in `lib/` so
    `npm test` reaches it. Back to front: `room` (the casino, the only layer
    allowed to be soft), `table` (felt, printed layout, shoe, discard tray),
    `dealers` (the pair, paws over the back rail), then live DOM `play` on top.
    Separate layers rather than one baked render, because a flattened image
    cannot swap an expression or let a card pass in front of the rail. Four
    expressions per dog — `idle`/`dealing`/`cheer`/`sympathy` — and the mapping
    from phase+outcome must stay **total**: a hole in it is two dogs frozen
    mid-grin through a losing hand.
  - **Every art path is nullable and null is not an error.** `SCENE_ART` and
    the dog art map are empty today; the component paints a CSS placeholder for
    any layer with no file, so the page is complete before a single PNG exists.
    Same "no verified asset yet" convention `music-manifest.ts` uses. Note the
    felt's printed text is a **rule claim** and must match the engine — a
    reference image reading "INSURANCE PAYS 2 TO 1" / "DEALER MUST HIT SOFT 17"
    would contradict `lib/arcade/blackjack.ts`, which has no insurance and
    stands on soft 17.
  - **`.bj-felt` is a two-row grid and is the single authority on where the
    table's rail is** — row one the dealers' airspace, row two the playing
    surface, the boundary between them the rail. Deliberately *not* a shared
    percentage restated in `23-blackjack.css` and `27-dealer-stage.css`: that
    two-places-one-number shape is what mis-aimed the old speech-bubble tails
    and what declared the in-game header's height twice. `.bj-surface` carries
    a negative top margin so the rail's lip passes **behind** the dogs' paws;
    z-order is room 0, surface 1, dealers 2, play 3. `.bj-play`'s top padding
    is *clearance* for `.bj-felt-print`, not taste — at the first value the
    dealer's name and total printed straight across "DEALER STANDS ON SOFT
    17", and the two live in different stylesheets, so a spec pins that they
    do not overlap at 1440 and 390.
  - **The page drew Loki and Finn TWICE, and that was most of what made the
    stage read as a television.** The 3D panel had them, and a 34px
    `<DealerAvatar />` beside the dealer's hand had them again forty pixels
    below in a different art style, both labelled "Loki & Finn". The hand row
    is text-only now.
  - **`tests/e2e/dealer-stage.spec.ts` was rewritten for the layer stack and
    all 6 specs pass.** *(An earlier note here said it was stale and failing;
    that was true of the WebGL-era file and is no longer.)* It asserts one
    room (every layer inside `.bj-felt`), the rail overlap's **sign** in both
    directions, `.bj-dealer-pair` at exactly 1 with
    `.bj-hand-head .dealer-avatar` at 0, that the cloth's print agrees with
    the page header and offers no verb the engine lacks, that the cards clear
    that print at both widths with no horizontal pan, and the whole tip money
    path. One trap it already hit: a first cut played a fourth hand to check
    the tip cooldown and hung the suite for six minutes — after three 1,000
    stakes and a tip, a losing session drops under the minimum and the Deal
    button becomes "Not enough Gold", so the test waited on a POST a disabled
    button was never going to send. Cadence is unit-tested over a 200-hand
    session instead; the browser only checks the money.
    **That trap is not fully closed — the tip spec is intermittently flaky for
    the same reason.** Observed 2026-08-07: the file failed once at 6.3 minutes
    on that test, then passed 6/6 twice and passed alone in 7.2s, with no code
    between the runs. The money check still plays real hands, and blackjack
    outcomes are random, so a losing run can drop the balance under the minimum
    stake and leave the spec waiting on a disabled Deal button until it times
    out. A 6-minute run of this file is that failure, not a slow machine. The
    real fix is to stake the test's own Gold rather than trust a session to
    stay solvent; do not "fix" it by raising the timeout, which just makes the
    hang longer.
- The flat SVG pair (`components/arcade/dealer-avatar.tsx`) reads its colours
  from `DEALER_DOGS` so it and the scene's dealer layer cannot drift. **Its one
  caller is now the scene's placeholder**, enlarged — the 34px call beside the
  dealer's hand was deliberately removed as the duplicate described above. It
  is still built to survive 34px, and two things about the redraw are worth
  keeping: **ears low, visor high.** The first cut put both dogs' ears as round
  lobes level with the eyes, which is a *bear* — an ear that starts above the
  eye and hangs past the muzzle is what says "dog" — and left the translucent
  visor panel crossing the pupils, the same mistake the 3D pair made twice.
  Since ear style no longer separates the two (both are drop-eared doodles),
  **colour is the only thing telling them apart**, so `dealer.test.ts` asserts
  the base coats differ by >80 in mean channel brightness and that Finn's is
  off true black; a black dog on this disc needs that plus a cream rim light or
  it is a hole in the picture.
  It is deliberately **not** a `ProfileAvatar` wearing some avatar cosmetic id:
  that catalog is player property — bought, or earned via
  `lib/server/avatar-unlocks.ts` — so dressing the house in one would imply
  the dealer is a player and quietly devalue an item somebody ground for. It
  must stay framed as a **face crop**, not figures: the first version of the
  old dealer drew a whole croupier inside the disc and at 34px the head was
  ~11px and the visor a green bar across it. Judge any change against a real
  34px render, not the 64-unit viewBox — a nudge in this pass was needed
  purely because Finn's eyes vanished under his own visor at that size.
- **Never call `renderer.forceContextLoss()` in a React cleanup**, and the
  reason generalises to any WebGL-in-React work in this repo. *(Historical: the
  stage this happened on has since been replaced by the 2D layers above, and
  `three` is uninstalled. The lesson is kept because the archived
  `archive/webgl-room` branch and any future WebGL work would hit it again.)*
  It was added as
  "obvious" hygiene — hand the GPU context back instead of waiting for the
  canvas to be collected — and it broke the stage everywhere. The canvas is a
  React-owned element that outlives the effect, StrictMode runs every effect
  twice in dev (mount → clean up → mount, same canvas), and a force-lost
  context can never be re-acquired, so the second mount got a dead canvas and
  the stage sat in its fallback forever. `renderer.dispose()` alone is correct.
  The cost was not the bug, it was the **misdiagnosis**: the symptom is
  identical to "this machine has no WebGL", and it was blamed first on
  GPU-process exhaustion from the canvas-heavy poker specs that sort ahead of
  `dealer-stage.spec.ts`, then on a missing SwiftShader flag — two rounds of
  test-harness surgery for a one-line component bug. The only real evidence
  was a single `THREE.WebGLRenderer: Context Lost.` console line. When a
  graphics fallback engages everywhere at once, read the browser console
  before touching the harness.
- **`TIP_LINE` is a real button now.** It used to be flavour with an explicit
  note saying it must never become one, because a control that takes Gold and
  does nothing is a defect dressed as a joke. `lib/arcade/tipping.ts` is the
  mechanic that earned it: `TIP_AMOUNTS` 25/100/500,
  `POST /api/arcade/tip` (rate-limited 6/min, `isBanned`-gated) and
  `lib/server/tip-service.ts`. Three things about it:
  - It is **the arcade's only pure sink** — one side, not two. The Gold leaves
    and does not come back, so most of the three ordering rules do not apply
    and the service says so rather than leaving the next reader wondering
    whether they were forgotten. The debit is still first; there is no
    settlement, so no version guard. The hazard for a sink is the mirror image
    of a payout's: *charging* twice, handled by the rate limit and a button
    that disables in flight.
  - **A tip earns XP at the ordinary rate and that is not an exploit.** XP is
    Gold-wagered/10 everywhere; a player grinding it by playing gives up the
    ~3% edge, one grinding it by tipping gives up 100%. Tipping is therefore
    the strictly worst way to buy a level that exists — the same parity
    argument `hand-completion.ts` makes about chips and Gold. `awardWager` runs
    last and is non-fatal, so a progression outage cannot tell a player their
    completed tip failed.
  - **The offer has a cadence** (`shouldOfferTip`): quiet until 3 hands have
    been dealt, then quiet again for 12 after the player pays or waves it away.
    An ask on screen from the first frame is one nobody reads and everybody
    resents. It is pure and unit-tested rather than a boolean in the component.
- `dealerLine` returns constants, and a test caps them at 28 characters. Same
  reasoning as the removed per-seat status pills: variable-length prose on the
  felt is what clipped before. `.bj-hand-caption` also pins one line with an
  ellipsis so a longer line added later clips instead of reflowing the felt.
- **Hi-Lo is the second live game** (`lib/arcade/hi-lo.ts`, `/games/hi-lo`,
  `app/api/arcade/hi-lo` + `.../actions`). One card face up, one call, one
  draw, settled. Same three ordering rules as blackjack, restated in
  `lib/server/hi-lo-service.ts` rather than referenced — breaking one is a
  silent money bug and the next reader should not have to open another file
  to learn why the sequence is what it is.
- **Hi-Lo's odds are derived from the deck, never fixed, and that is
  load-bearing.** A flat even-money table would be a money pump pointed at
  the house: calling "higher" on a 2 wins 48 of 51. For a call that wins on
  `w` unseen cards the fair net multiplier is `(51 - w)/w`, and
  `HI_LO_HOUSE_EDGE` (3%) comes off that. Because exactly one card leaves the
  deck, `w` depends only on the base card's rank — which is why the price can
  honestly be quoted on the button *before* the call.
- **A tie loses at Hi-Lo, and removing that breaks the game, not just the
  margin.** With ties pushing, "higher" on a 2 is a certainty, so fair odds
  pay exactly zero and the player stakes Gold to win nothing. Counting the
  three same-rank cards as a loss makes even the safest call a real 48/51 bet.
  The felt says so in as many words.
- A call no card can win ("lower" on a 2, "higher" on an ace) is disabled, not
  priced at zero — a button that can only take money is not a choice. The
  engine returns the round unchanged for it and the service turns that into a
  409, so a no-op can never look like a played round.
- Two tests guard the payout table and they do different jobs. The exact one
  walks all 13 ranks x 2 calls and asserts no combination is positive EV —
  that is the exploit guard. The seeded 60k-round Monte Carlo exists because a
  live 300-round sweep read **-9.16% of turnover** against a 3% design, which
  looks like a mispriced table and is not: the tail is heavy (an 11x payout at
  4/51). At 60k rounds it lands at -0.43% realized against -1.41% closed-form.
  Do not "fix" the edge on the strength of a few hundred rounds.
- `lib/server/arcade-round-store.ts` + `arcade_rounds` (migration
  `20260805180000`) is blackjack-store generalised over a `game` column,
  written when the second game arrived rather than guessed at when the first
  did. Its unique index is on `(profile_id, game)`, not `profile_id`: a player
  may sit at Hi-Lo and Blackjack at once. **Blackjack still uses its own
  table on purpose** — it is live, it moves real Gold, and its Supabase path
  has not yet been exercised by a real hand, so restacking its storage
  underneath it would pile one unproven thing on another. Folding it in is a
  clean follow-up once it has settled some real rounds.
- Game #3 copies: `lib/arcade/<game>.ts` (pure engine, randomness by
  injection, a `to*Snapshot` that drops the deck), a service holding the three
  ordering rules, `arcade-round-store` for persistence, two routes, and a
  `<game>-table.tsx` reusing the `.bj-*` shell. Only what the game genuinely
  adds gets new CSS — `24-hi-lo.css` is ~60 lines because the rest is
  Blackjack's.
- The arcade tables tally settled rounds in a `useEffect` keyed on `round`,
  not inside the fetch path. `react-hooks/refs` correctly flags a ref read
  reachable from a click handler, and every path that yields a settled round
  (an action, a resume, a 409 carrying true state) goes through `round`, so
  there is one place to get it right instead of three. Both tables match;
  keep them matching. That tally now lives once, in
  `components/arcade/use-casino-machine.ts` — see the bullet below.
- **`.bj-felt` is the BLACKJACK ROOM, not a generic panel, and seven machines
  had inherited it by accident.** It is a two-row grid whose first row is Loki
  and Finn's airspace and whose row boundary *is* the rail; Blackjack wraps its
  cards in `.bj-play` and lands them in row two, which is correct there and
  only there. Every other game wrote `.bj-felt` and dropped its children
  straight in. One mistake, three defects that did not look related: a
  130–260px dead band above the wheel/reels/cards on six pages (row one, with
  no dealers in it); video poker's pay table and its five cards sharing an edge
  *to the pixel*, because auto-placed rows have no gap — the glass's rounded
  bottom corners were cut off by the card row; and, on a 390×844 phone, row
  one's `minmax(clamp(132px, 22vh, 260px), .85fr)` resolving to ~240px against
  Sudoku's `aspect-ratio: 1` 340px grid, which overflowed its own track and
  painted **over** the keypad and the player's row — the digits showed through
  the cells. `.hud-felt-plain` (28-arcade-hud.css) is the fix: a plain centred
  column at `flex: 1 0 auto` so a table still fills a short page and a board
  takes the room it needs instead of being clipped into its neighbour.
  **Its `overflow: hidden` is inherited from `.bj-felt` and must stay** — it
  clips no content now, but it is what contains `.bj-felt::before`, the house
  glow, which is inset `-10%` on both sides; relaxing it to `visible` put
  134px of pseudo-element past the right edge of a 1440px page and panned the
  whole arcade sideways, on seven machines at once. Blackjack is deliberately
  *not* given the class and renders identically.
- **Sudoku's box frame was open in four places on every board, and the shape of
  that bug is worth knowing.** `box-shadow` does not add across declarations,
  and the heavy 3×3 rules were enumerated one rule per combination — so
  wherever two of the four `.sk-cell-box-*` classes met with no combined rule
  and equal specificity, the later one in the source simply won and a side was
  silently dropped. Both such cells exist: a last-column cell that also opens a
  band (rows 0/3/6 of column 8) lost its top rule, so the grid's top edge and
  both band separators stopped one column short, and a bottom-row cell that
  also opens a band (columns 0/3/6 of row 8) lost its left rule the same way.
  It is four custom properties now — one slot per side, all four always listed
  — which cannot have that bug at any combination. Judge it on a crop, not on
  the rules: at 1:1 the missing segments read as an artefact of the screenshot.
- Baccarat opened on a `"5k"` stake while a new profile carries 2,000 Gold, so
  the first thing a player saw was a dead "Not enough Gold" button with nothing
  saying the cheaper rung beside it would have worked. It is `"1k"` like every
  other machine. Same family as the catalogue-price lies above: **check a new
  default against the wallet a new player actually has.**
- **`entryComplete` in `poker-app.tsx` is now restored from the session
  cookie, and the arcade is why.** It is plain component state that starts
  `false` on every mount, and the arcade lives on its own routes
  (`/games/*`) — so "← Back to the lobby" remounts `PokerApp` and used to drop
  a player who had already entered back onto the sign-in card. `loadProfile`
  sets it true when a profile comes back: the cookie is the durable record of
  having been through the gate, and it is already scoped to the remember-me
  choice, so a guest session cookie still dies with the browser and a fresh
  visitor still meets the gate. `signOut` is unaffected — it clears the cookie
  before it reloads, so the profile comes back null.
- **The arcade is all ten games now.** Video Poker, Roulette, Coin Flip,
  Baccarat, Daily Sudoku and Memory Match landed together; every
  `coming-soon` row in `lib/arcade/games.ts` is live with a real engine, a
  service, two routes and a page. **No migration was needed**: `arcade_rounds`
  and `daily_puzzle_rounds` both take a free-text `game` column, which is
  exactly the extension point their headers promised, so the whole slice ships
  without the schema/deploy ordering hazard that cost players Gold in the
  `credit_gold` incident. Five things worth carrying forward:
  - **The three money-ordering rules are implemented once now, not restated
    six times.** `lib/server/casino-round-service.ts` holds debit → deal →
    act → credit for the four new wager games; a game supplies only `deal`,
    `payout`, `snapshot` and an optional `validate`, and gets the ordering
    for free. At two games restating the rules in a header comment was right;
    at six it becomes six chances to get the same thing wrong, which is the
    argument `arcade-request.ts` already won here. **Blackjack and Hi-Lo were
    deliberately left on their own copies** — they are live and move real
    Gold, and restacking them under a module whose first four callers are all
    unshipped would pile one unproven thing on another. Building it exposed a
    real hole: `deal()` ran *after* the debit but *outside* the refund `try`,
    so an engine throwing its own precondition would have taken the stake and
    returned nothing. `deal` is inside the try now, and `validate` runs before
    the wallet is touched at all.
  - **Each game's house edge is a test, not a comment.** Roulette asserts that
    every bet on the layout returns exactly 36/37 — a bet that came out cheaper
    is a hole in the book, one dearer is a second rake hiding behind the zero.
    Baccarat's third-card tableau is transcribed cell for cell from an
    independent table and its edges land on the textbook 1.06 / 1.24 / 4.84%.
    A mispriced casino game is not a visible bug: it plays, it pays, and it is
    quietly wrong, so these are the guards that matter most in those files.
  - **Two catalogue prices were lies and one blurb was.** `video-poker` sat at
    500 and `coin-flip` at 250 — neither is a stake `TIER_CONFIG` can select,
    so the hub quoted a price no button in the game could charge. That is the
    third time (Hi-Lo's was the first): price a new row off the ladder or
    leave it 0. Coin Flip's "double or nothing" was worse than wrong, it was
    unofferable — a fair coin paying exactly 2x has a house edge of *precisely
    zero*, which is a hole in the economy rather than a generous game. It is a
    bank-or-ride streak game now: the coin stays honestly 50/50 and the margin
    is in the price (1.97x), capped at six wins so the pot cannot compound
    without bound at the 500k tier.
  - **The reveal waits for the animation, and it is derived, not held.**
    Roulette's response necessarily carries the winning number, so showing it
    and *then* spinning a wheel toward it would make the animation a
    re-enactment. `revealed` is computed from "which round's wheel has
    finished" rather than stored by an effect — which is both what
    `react-hooks/set-state-in-effect` wants and what keeps a resume honest: a
    refresh mid-spin replays the wheel, a refresh afterwards does not. Coin
    Flip uses the same shape with a flip *count*. Six lint errors of this
    class were fixed properly rather than suppressed; the credit meter now
    writes digits straight to the DOM (the `use-fuse.ts` pattern) instead of
    pushing sixty renders a second through React.
  - **The lobby's mute reached the arcade for the first time.**
    `SOUND_STORAGE_KEY` was a private const inside `poker-app.tsx`, which is
    not mounted on a `/games/*` route, and `setSoundEnabled` defaults to
    `true` — so any machine that made a noise would have been loud for a
    player who had muted the app, on a screen with no control to fix it. The
    keys are `lib/audio/sound-preference.ts` now and
    `components/arcade/use-arcade-sound.ts` applies them before anything can
    play.
- Sudoku is the one arcade engine with real algorithmic weight, and two things
  about it are worth knowing. It **generates from the day** rather than from a
  puzzle bank — a solved grid is built by permuting a known-valid pattern
  (which cannot fail or backtrack) and clues are carved only while
  `hasUniqueSolution` still holds. The four difficulties are salted
  separately, so solving the easy grid hands nobody the expert one, and they
  are four `game` values (`sudoku-easy`…) so the store's unconditional unique
  index gives one attempt *per difficulty* per day. `countSolutions` needed a
  pre-check that the *givens* do not already clash: the search only inspects
  empty cells, so a contradictory grid sent it enumerating a space that cannot
  exist — it hung the test suite for two minutes before that line existed.
  Boards are cached per (day, difficulty) in module memory, which is safe
  precisely because generation is deterministic.
- **Memory Match deliberately breaks the shared-daily rule, and that is the
  point.** Every other daily gives everyone the same board because that is
  what makes a shared score mean anything. Memory is the one where a shared
  layout *ends* the game — one screenshot in a group chat and nobody has a
  puzzle — so the board is shuffled per attempt and what is compared is time
  and turn count over the same eight ranks. Its redaction is the strictest in
  the arcade: `board[i]` is `null` for a face-down tile, not a card flagged
  hidden, and a test asserts that turning one card over does not reveal where
  its partner is.
- Sudoku's answer never leaves the server either, which forces a request per
  digit: a wrong one is refused and *counted*. That does let a determined
  player find any single cell by trying digits, and it is a deliberate trade —
  the alternative (no feedback until the grid is full) makes an honest mistake
  a silent twenty-minute waste. Brute force shows up as "46 mistakes" in the
  share text, which is what keeps the claim honest. There is no emoji matrix
  for Sudoku on purpose: a block grid would show which cells were givens,
  which is the shape of the puzzle.
- **Daily Wordle and Connections are live** — the arcade's first `kind:
  "puzzle"` entries (free, no stake), shipped end to end in PR #14 (merge
  `e357225`) and verified against the Production deployment's own status
  *and* the live pages/APIs responding with real payloads, not just the
  merge. Architecture: pure engines in `lib/arcade/puzzles/` (wordle.ts,
  connections.ts, plus the day-keyed rotation in daily.ts and curated data
  files), services holding the ordering rules
  (`wordle-service.ts`/`connections-service.ts`), a shared
  `daily-puzzle-store.ts` over the new `daily_puzzle_rounds` table, four
  routes, and boards reusing the Blackjack shell (`25-puzzles.css` cascades
  after 23/24). `daily_puzzle_rounds` is a sibling of `arcade_rounds` with
  one deliberate difference: its unique index on `(profile_id, game,
  puzzle_day)` is **unconditional**, not partial on `active` — one attempt
  per player per day, finished or not, because a replayable daily would make
  the shared grid a claim nobody could trust.
- **The emoji share matrices (`lib/arcade/puzzles/share.ts`) are the
  retention loop, and their anti-leak property is structural**: every
  generator takes the already-redacted *snapshot*, never the round, so the
  module cannot leak an answer even by accident. Tests assert the share text
  contains no answer or guessed word, that an in-progress round refuses to
  build a share at all, and that the blocks are the palette everyone already
  reads (🟩🟨⬛; Connections 🟨🟩🟦🟪 by difficulty). Pure string building —
  no DOM, no `navigator` — so it all runs under `npm test`; the share sheet
  itself is `components/arcade/share-result-button.tsx`.
- *(Superseded — all ten are live now; see the bullet above. Kept because the
  rules it states still govern adding an eleventh.)* The six remaining
  `lib/arcade/games.ts` entries are still
  `status: "coming-soon"` with `href: null` — catalogue rows, no engines, no
  routes, no client. There is nothing there to server-validate, and the poker
  table has been server-authoritative from the start. A hub blurb must not
  promise a mechanic the table lacks: Hi-Lo's said "ride the streak" while it
  was a placeholder and there is no streak, so it was reworded when it went
  live. Likewise `entryCost` must be a stake the tier ladder can actually
  select — Hi-Lo's placeholder 500 was not one.
- `lib/game/deck.ts` is new: `SUITS`/`RANKS`/`DECK_TEMPLATE`/`makeDeck`, lifted
  out of `engine.ts` unchanged so the arcade deals from the same deck the poker
  table does. The shuffle takes `randomInt` as an argument rather than
  importing it — `engine.ts` passes `node:crypto`'s, which a client page has no
  access to, and importing it inside the shared module would drag it into the
  browser bundle of anything wanting a deck. Fisher-Yates is byte-identical, so
  no seeded test shifted.
- The catalogue itself is `lib/arcade/games.ts`, not data inside the
  component — `vitest.config.ts`'s `include` only covers `lib/` and `app/`, so
  anything under `components/` is unreachable by `npm test` (same reason
  `lib/game/seat-presence.ts` exists). Blackjack is `status: "live"` with an
  `href`; the other nine are `"coming-soon"` with a null href, the same "shape
  is finished, the switch is two fields" convention `music-manifest.ts` uses. A
  test asserts live-iff-href, since a live entry with a null href renders an
  unclickable Play and a coming-soon entry with an href is a 404 waiting to be
  linked. Rows are already wallet-aware:
  `toArcadeWallet`/`canAffordArcadeGame`/`arcadeBlockedReason` treat a missing
  profile as an empty wallet (never unlimited — the hub renders during the
  first-POST window before a profile exists) and honour `unlimitedGold` the
  way the rest of the app does, and the stake renders through `.gold-balance`,
  the navbar badge's own coin+amount layout. Casino entries are priced on the
  `TIER_CONFIG` ladder (250–5,000); `kind: "puzzle"` is free and is a field
  rather than something inferred from a zero cost.
- **M16's invite half is now complete except for one wire.** `POST /api/invites`
  sends one; `POST /api/invites/[id]` accepts or declines;
  `respondToTableInvite` and `findPendingTableInvite` are the store's write and
  peek. The drawer lists live invites with a countdown, polls every 15s, and
  grows an Invite button per friend row when opened from a private table —
  which is what the new "Invite a friend" entry in `poker-table.tsx`'s menu
  does (gated on `isPrivate && isSeated && isRegistered`, because the route
  enforces exactly that and a menu entry that always 403s is worse than none).
  **Accepting is a join, not an acknowledgement**: the route redeems the room
  code into a seat server-side and returns the snapshot, so no client ever
  holds the code. Two things to know before finishing it:
  - **The one missing wire is `onJoinedTable` in `poker-app.tsx`.** The drawer
    takes that optional callback and only renders Join where it is supplied;
    `lobby.tsx` cannot supply it because the handler has to `setGame`. There is
    no resume-on-load path (`game` starts null and nothing fetches an active
    table on mount), so a reload cannot substitute. It is a one-line prop pass
    — it was left undone only because `poker-app.tsx` had uncommitted work from
    a concurrent session at the time.
  - **There is still no way to *start* a friend request in-app**, so invites
    only work between people who are somehow already friends. `Seat.profileId`
    exists for exactly this and the seat menu that would use it is still the
    next slice. Judge any felt-side control against the status-pill history —
    `table-feed.spec.ts` asserts no seat renders one.
  - Accept ordering, which is the part worth not breaking: pre-flight the
    fixable failures (table gone, full, cannot afford) *before* consuming the
    invite, then consume via the status-guarded write, then debit and seat with
    a refund on failure. Burning a one-shot invite to say "you need more Gold"
    makes a fixable case unrecoverable; consuming after seating lets two tabs
    buy in twice.
- **M17 (chip cosmetics) is deliberately not started** — the user parked it
  until the 3D simulation is finished. Do not pick it up without them saying so.
- **3D character ownership is live.** The original six GLBs are the free
  starter roster. Of the eight customer-pack characters, Claira/Donni/Jimmy/
  Kenji unlock at 10/50/150/500 lifetime hands won; Derek/Oscar/Victor/Marcus
  cost 1m/2m/4m/6m Gold. These rules live in `lib/cosmetics/catalog.ts`, so
  `listOwnedCosmetics` and `equipCosmetic` enforce them server-side. Never set
  every generated 3D cosmetic back to `price: 0`: free catalog entries are
  implicit ownership and would let a new player equip the entire roster.
- **3D chips are a dealer's push now, not a spray, and one function decides
  where every chip is.** `pileSlot` (`lib/game3d/chip-instance-model.ts`)
  answers "where does the nth chip of this pile sit"; a resting pile reads
  it, and so does a flight's landing target, so a chip's destination IS its
  resting place rather than an approximation that snaps on arrival. Five
  things worth not relearning:
  - **The old `landingOffset` scatter was two bugs wearing one function.**
    It aimed a whole group at a *point* and strewed them around it by a
    golden-angle wave of radius `CHIP.radius * 0.92 * sqrt(index)` — so a
    bet had no stack to land in and piled up by `index % 3`, reading as
    chips inside one another. The same wave doubled as resting-pile
    "jitter", where the sqrt growth meant the pot (seed 101) offset its
    discs by ~3.5 chip radii: a strewn heap, not a stack. Jitter is bounded
    at `PILE_JITTER_FRACTION` (6% of a radius, constant) now, and the
    scatter is gone entirely. Heights come from `chipStackY`, stated once.
  - **`buildPushLegs` resolves explicit per-chip legs, and it runs in
    chip-field's RENDER body, not at launch.** A chip's slot depends on how
    many chips already rest at the destination — bookkeeping that component
    already does once per render to decide the piles. Computed at launch
    instead, a second bet arriving at the same spot aims at slots the first
    one took. Sources are peeled top-first, because that is where a hand or
    a dealer takes chips from; the payout is now a sweep off the top of the
    pot into the winner's stack, from distinct pot slots.
  - **Cadence comes off `seat.lastAction`, which is the only thing in the
    snapshot that separates a call from a raise** — the `streetBet` delta
    says a bet happened, not how. `lib/game3d/chip-push.ts` maps the
    engine's labels to a style; staggers are pinned inside 70–90 ms by a
    test, and `pushKindFromAction` strips a trailing amount as well as
    splitting on `·` so the scripted demo's "raise 30" classifies too.
  - **Reduced motion lands the identical coordinates, not similar ones.**
    That is a property of explicit destinations, and a test asserts the two
    pose arrays are equal rather than close.
  - The chip is lathed from a real profile with a `CHIP.bevel` break
    (chip-stack.tsx) — a cylinder's sharp 90° cap gives the rim one shading
    value under this single hard spot and reads as a counter — plus
    roughness and bump maps (`NoColorSpace`; tagging data sRGB turns 0.55
    roughness into 0.26). Still one shared geometry, three material groups,
    one InstancedMesh per denomination. Pile shadows lost most of their
    footprint and darkness, and `pileShadowPose`'s per-pile `opacity` —
    computed since the file was written and thrown away by the renderer —
    is finally applied, via `setColorAt`: under this multiply blend the
    output is `dst * (1 - a(1 - colour))`, so a grey instance colour scales
    a decal's darkness at no extra draw call.
- **The 3D room's camera fit is exact now, and the table has its real plan
  shape.** Five things worth not relearning:
  - **`frameCamera` is a search, not a formula.** The closed form solved each
    axis separately and took the larger, summing two upper bounds that never
    co-occur — so landscape distance came out CONSTANT at 6.21 for every
    aspect >= 1.5, leaving 36% of an ultrawide frame dead. It bisects distance
    and Newton-steps the aim over the real projected point set now: 40 + 6
    fixed iterations, ~250 scalar projections, once per resize, no allocation
    (`boundsAt` is scalar-only and deliberately does NOT route through
    `projectToNdc`). Every aspect now fills to exactly `1/SAFETY`.
  - **The probe set was measuring width at the wrong height.** It checked
    half-width at `FELT_TOP_Y` only, but a body stands 1.5 units up and is
    therefore NEARER a downward-looking camera, where the same x projects
    wider — and its `landscapeness >= 1` gate was a step over a continuous
    blend. At 1180x820 the outer seats projected to |x| = 1.04, clipped, with
    the fit reporting success. `aimDrop` (metres) became `contentBias` (NDC)
    for the same class of reason.
  - **The felt was 1.63:1; a real six-max oval is 2:1.** `FELT_RADIUS_Z` is
    derived from `TABLE_WIDTH_M` now, not typed, and `dimensions.ts`
    re-exports `TABLE_LENGTH_M` from seat-layout so there is one 2.13. This
    was not only accuracy: the fit is bound by DEPTH at every landscape
    aspect, so a rounder table pushes its own camera back and cannot use the
    width it freed. Felt went 41% -> 50% of an ultrawide frame and 44% -> 55%
    on a landscape phone.
  - **Re-proportioning broke four tests, and each was a real defect.** The
    bankroll props are physical objects at a fixed real size, so an 18%
    shallower plate put the deep tier's corner at 1.02 of the felt ellipse
    (inset 0.84 -> 0.82, angle offset 0.36 -> 0.50, both re-solved by scan,
    and `HOLE_CARD_INSET` 0.82 -> 0.78 because bankroll must sit strictly
    outside cards). And the near/far seats moved 1.78 -> 1.55, deep into the
    cone where a smoothstep is flattest, so folding stopped reading as
    walking into the dark: the truss dropped 3.2 m -> 2.6 m to steepen the
    gradient, with `intensity` re-exposed 230 -> 156 by `(5.60/4.39)^1.6` so
    the change touched shape and not brightness. `SPOT_POOL_RADIUS` is
    derived from `FOLD_SLIDE` now, which is what its comment always claimed.
  - **There is no backdrop and cannot be one.** Every frustum ray hits the
    floor — the top-left corner still descends ~28 degrees — so a skybox or
    wall would be drawn entirely off screen. `lib/game3d/floor-environment.ts`
    owns the background instead: `FLOOR_RADIUS` solved from the camera (the
    literal 9 was already 0.6 units narrower than the frame at 2560x1080,
    hidden only because fog happened to be opaque out there), a vertex-colour
    carpet whose rim colour IS `STUDIO_BACKDROP` so a lit floor meets a fogged
    void with no horizon line and no fog-exempt materials. One draw call, 432
    triangles. Vertex colours go through `THREE.Color(..., SRGBColorSpace)` —
    written raw they render far darker than the literal reads, which on a
    near-black palette is "gone". `horizonInFrame()` is the assertion the
    whole premise rests on.
  - **The room runs `frameloop="always"` and must.** drei's `useAnimations`
    ticks the .glb mixers through `useFrame`, so demand mode freezes every
    seated character. `awake()` reporting false while `framesRendered()`
    climbs is correct — `awake()` is the CHIP scheduler. Do not "fix" it.
- **The classic 2D table's hole cards and bet labels are compact and
  seat-anchored now (2026-08-10), 2D only — the 3D room above was explicitly
  out of scope.** Ground truth for the whole pass was
  `window.__stackchipsScene.betSpot(slot)`, read live and diffed against the
  DOM, not derived on paper: the two ellipses (the DOM's percentage one in
  `lib/game/table-geometry.ts`, the canvas's world-unit one in
  `lib/scene/seat-ring.ts`) are different shapes and cannot be reconciled by
  one flat constant, so every number below was measured, not guessed.
  - **Your own hole cards dropped from a 104px ceiling to a 50px one**
    (`16-first-person.css`), and moved from floating above your own head to
    sitting beside your figure (`left: 100%` on `.seat-mine .seat-cards`,
    vertically centred on the avatar) — the 104px cap, not the position, was
    the actual complaint. Opponent backs shrank .26 → .20 of the seat and
    pulled up from the chest (`top: 80%`) to `66%`, nudged along the
    outward `--seat-out-x/-y` vector `poker-table.tsx` now publishes per seat
    (see below) so they read as tucked beside the avatar rather than centred
    below it — kept below the 48%-of-face-height floor
    `visual-layering.spec.ts` enforces the whole time, since that line exists
    specifically so a card back never masks a player's own face.
  - **The bet-amount label and the chip pile it should sit beside were ~80px
    apart at every seat**, because `.table-bet`'s reach was a flat pixel
    offset (76px) along the DOM ellipse's inward vector while the canvas
    pile lives at `BET_INSET` (0.74 of the felt's own radius) in a
    differently-proportioned world ellipse — two independently tuned systems
    that only agreed on direction. 155px closes the x-axis to under a pixel
    at every side seat; the y-axis has an irreducible 17-70px residual
    depending on seat angle, which is the two ellipses' shape mismatch, not
    an untuned number. The local player's own bet needed a *separate*
    205px override (`.seat-mine .table-bet`) rather than a bigger shared
    constant: `NEAR_SEAT_BET_INSET` (0.35) pulls that one pile in toward the
    centre instead of out toward the rail, so it was never the same target.
  - **`--seat-out-x`/`--seat-out-y`** (`poker-table.tsx`, the negation of the
    existing `--seat-dx`/`--seat-dy` toward-pot vector) is what both the
    card nudge above and any future compact-marker work should read for
    "away from the pot" — it did not exist before this pass.
- **The 3D roster's hands rest on the felt and are aimed at their own cards
  now (2026-08-12), and the reason they never could be before is a
  measurement.** The only thing touching an avatar's arms at runtime was
  `arm-ik.ts`'s felt clamp, which is purely negative — it stops a wrist
  sinking through the cloth and says nothing about where a wrist should be —
  so every hand sat where the baked clip left it: mid-air, fingers closed on
  nothing, which the owner described as "holding a flute". Six things worth
  not relearning:
  - **Every seat but the far one is physically OUT OF REACH of its own
    cards.** Measured off the live bones on the real GPU: shoulder-to-card
    runs 0.50-0.92 world units against a fully-extended arm of 0.54-0.60, so
    five of six seats are 0.12-0.38 units short. No solver fixes that — an
    IK solve asked for an unreachable target returns its best miss. The fix
    is that the wrist is aimed a hand's length BACK from the cards
    (`CARD_HAND_SETBACK`, `lib/game3d/hand-anchors.ts`), because it is the
    FINGERTIPS that have to arrive; that alone buys back ~0.14 units and
    drops the residual to 0.000-0.100, worst on the near seat, which is seen
    from behind.
  - **A torso lean was built, measured and REMOVED — do not re-add one
    casually.** It is the obvious third lever and it fails twice: against
    residuals that small, a lean big enough to matter reads as hunching (at
    its 24-degree cap it put heads through the rail), and the loop is
    unstable by construction, since leaning reduces the deficit that asked
    for the lean, so it hunts. What is left is absorbed by
    `reachableTarget`, which shortens the reach along the FLOOR rather than
    down the line of sight — that distinction is what stopped hands hovering
    at chest height, since the sight line rises away from the table as it
    shortens.
  - **The old IK never applied more than a quarter of its own correction, at
    any frame rate.** It slerped each bone a `dampingFactor` fraction toward
    the solved rotation every frame — right for a value that persists, wrong
    here, because the mixer rewrites every bone from the clip at the start of
    each frame, so the correction restarted from zero forever. Smooth the
    TARGET and apply the solve at full strength (`dampPointToward`).
  - **The uniform finger curl WAS the flute, and the fix has to be
    absolute.** `build-poker-character-animations.py` applies the same
    24/18/10 degrees to all five digits including the thumb; five identical
    cylinders at the same phase is geometrically a grip round a tube. The
    clips key all 40 finger bones, so a delta leaves that curl underneath —
    `lib/game3d/hand-rig.ts` rebuilds each digit from its captured BIND
    rotation instead. `shapeVariation` is the executable guard: the bake's
    shape scores exactly 0 and a test requires more.
  - **Flexion axes are derived from bind geometry, never named.** The bake
    gets to say "local X" because it runs in Blender's bone space; glTF nodes
    carry the exporter's convention instead. Each joint's curl axis comes
    from its own child direction crossed with the palm normal, sign-checked
    with `curlsTowardPalm` — get the cross product's order backwards and
    every finger on every character bends the wrong way, which a render shows
    and tsc does not. Angles are calibrated against the T-POSE they compose
    onto, not against a straight finger: near-zero curls reproduce the T-pose
    and gave six characters rigid spread claws, a different wrong hand rather
    than a fixed one.
  - **Judge these at their rendered size.** A hand is ~30 px at 1440x900;
    two rounds were spent tuning against 400% crops that a pixel-diff then
    showed were responding correctly all along. Same lesson
    `dealer-avatar.tsx` records at 34 px. Scratch scaffolding: `arm-rig.ts`
    holds the three.js side (bones, bind measurement, per-frame drive),
    `hand-anchors.ts`/`hand-rig.ts`/`vec3-math.ts` the pure halves, 394
    `lib/game3d` cases. The store's preview canvas passes `atTable={false}`
    and gets `poseFingersOnly` — every anchor here is a world-space point on
    a table that canvas does not contain.
- **M18 is in: player rank, XP and a daily streak.** `lib/progression/rank.ts`
  is the whole curve, pure and closed-form (XP = Gold wagered / 10; level N
  costs `XP_STEP·(N-1)N/2`, inverted by a square root that is then re-checked
  against integer arithmetic, because a float that drifts shows level 9 to
  someone holding exactly the XP for 10). `lib/progression/streak.ts` is the
  daily multiplier, keyed on `YYYY-MM-DD` UTC day strings rather than
  millisecond arithmetic. `lib/server/progression-store.ts` +
  `20260806200000_player_progression.sql` persist it; `GET /api/progression`
  reads it; `components/profile/rank-strip.tsx` draws it in the lobby. Points
  that are load-bearing rather than decorative:
  - **The migration is written but NOT applied anywhere.** A live dev server
    against the real project returns `Could not find the table
    'public.player_progression' in the schema cache`. This is exactly the
    `credit_gold` incident the checklist above exists to prevent: apply it and
    confirm `supabase migration list --linked` before any of this code merges.
    The one reassurance is that the failure is contained — a blackjack deal
    against that same server still succeeded, because `awardWager` swallows its
    own errors by contract.
  - **The rewards are small in Gold and large in standing, on purpose.** Gold
    is sold for real money, so a level reward is a faucet. Only every fifth
    level pays, and a test asserts the whole ladder to level 100 pays back
    under 1% of the turnover it takes to climb it — inside the arcade's ~3%
    edge, with room for the daily grant on top. The streak multiplier is capped
    at 7 days / ×2.5 for the same reason. Do not raise either without redoing
    that arithmetic.
  - **There is no `level` column, and there must not be.** `levelForXp` derives
    it; storing it too would be a second definition of the ladder *and*
    unwritable without a race (the level a write lands on is unknown until
    after the write). `award_progression_xp` returns the xp on both sides
    instead, which is all `rewardsBetween` needs — and returning both is what
    makes "did this cross a level" answerable exactly once.
  - Ordering: the XP write happens before its reward is paid, and the payout
    goes through `creditGold` (the guarded RPC), never `adjustGold`, which is
    still a plain read-then-write. Both rules are restated at the top of the
    store because breaking either is a silent money bug.
  - Hooks live in `blackjack-service.ts` (deal, and again on a double),
    `hi-lo-service.ts` (deal) and `hand-completion.ts` (poker, `seat.committed`
    as the wager — chips and Gold are at parity across the buy-in/cash-out
    boundary, so one surface must not become the efficient place to grind).
    **The roulette/video-poker/coin-flip services a concurrent session was
    building were left unhooked** — adding progression is one `awardWager` line
    per settle path. The poker hook has no per-hand idempotency key of its own
    and relies on `onHandCompleted`'s "once per completion, only when the write
    won" contract.
  - The claim route records the streak *before* attempting the credit. Safe
    only because `streakAfterClaim` is idempotent for the day; reversed, a
    process dying between the two pays the multiplier without recording the day
    that earned it.
  - `.rank-strip` sits between the hub head and `.hub-grid`, never inside it —
    the grid's spans are arithmetic and a fifth small tile reopens the hole the
    arcade panel was added to close. It renders nothing until its fetch lands,
    so it cannot push the tiles down and then pull them back.
- **M19 (lobby expansion) was not touched**: a concurrent session owns that
  surface. Everything in `components/arcade/`, `lib/arcade/{roulette,
  video-poker,coin-flip,hud,dealer-rig,dealer}*`, `lib/server/{casino-round,
  roulette,video-poker}-service.ts`, `app/styles/27–30`, `app/globals.css` and
  `components/poker-app.tsx` was deliberately left alone. That constraint is
  why progression styles went into `04-lobby.css` and `21-friends.css` rather
  than a new numbered sheet — a new sheet needs a `globals.css` import.
- Invite freshness is a predicate on each row's `expires_at`, never a
  consequence of the sweep. `getPendingTableInvites` filters
  `expires_at > now()`, so a lapsed invite disappears the second it lapses
  even if nothing has marked it `expired`. `expireStaleTableInvites` is
  housekeeping — throttled to once a minute per process off the polled read,
  and called unconditionally by `createTableInvite`, which is the one caller
  whose correctness needs it: `table_invites_one_pending_per_target` is
  partial on `status = 'pending'`, so a timed-out row still marked pending
  would hold the slot and turn a legitimate re-invite into `already_pending`.
- `app/styles/21-friends.css`'s `.friends-list`/`.friend-row` padding now
  matches `.activity-list`/`.activity-item` in `11-panels.css` (12px, not
  8px/10px) — both share the exact `.history-drawer` shell, and the two
  panels ticking at different paddings was the only real inconsistency a
  rendered check turned up. `.friends-list` also hides its scrollbar
  cross-browser (`scrollbar-width: none` + `::-webkit-scrollbar`) while
  staying scrollable; verified against a live dev-mode render with a mocked
  `/api/friends` payload, not just by reading the CSS.
- Invites are private-table-only, and that is schema, not policy:
  `table_invites.room_code` is not null and a public table's `roomCode` is
  null. The code stays server-side — `PendingTableInvite` omits it and the
  read never selects it, so accepting can join without either party being
  handed something they could forward. A test asserts the absence.
- State: M12–M15 landed. M15's server half (hand archives, `archive_hand` RPC,
  `/api/history` routes) is unchanged and still has no UI reading it.
- Friends are registered-accounts-only, matching `/api/history`: 401 with no
  session, 403 for a guest. `requireRegisteredProfile` in
  `lib/server/api-auth.ts` is the single place that split lives.
- `friends-store.ts` projects to its own `FriendSummary`/`PendingRequest`
  rather than returning `PlayerProfile`. Deliberate: `publicProfile()` carries
  `goldBalance`/`unlimitedGold`/`lastDailyClaimAt`, which are fine to show an
  owner about themselves and wrong to show about anyone else. A test asserts
  the absence.
- Accepting a request goes through the `accept_friend_request` RPC
  (`20260804140000_accept_friend_request.sql`), not two PostgREST calls. Split,
  a failure between settle and insert leaves "accepted but not friends", which
  no retry can detect because the request is no longer pending.
- Duplicate/crossed friend requests are detected by the two partial unique
  indexes and surfaced from a `23505`, not by a check-then-insert. Checking
  first cannot see the crossed case (A asks B while B asks A) without a lock.
- `Seat.profileId` carries a *registered* human's profile id into the public
  snapshot, so one player can name another without the client ever holding
  `ownerToken`. Persisted at seat time, not resolved on read: `toSnapshot` is
  pure and synchronous, and `ensureProfile` both writes and would run per seat
  per fetch. Guests stay null — a request addressed to a cookie-lived profile
  can never be accepted. `normalizeGameState` pins non-humans to null, so a
  stale id cannot survive one round trip.
- Every path that makes a seat human must set `profileId`, and `claimSeat` is
  now the only such path — it sets it. The rule is worth keeping in mind
  anyway, because normalize cannot enforce it: a seat that is already human is
  not something `normalizeGameState` will pin back to null, so a path that
  turns a bot seat human without writing `profileId` leaves the *previous*
  occupant's id in place. (The table-manager adapter's `applyHumanIdentity`
  was exactly that hazard — it cleared the id, having only a session token —
  and it went with the rest of the dead worker; see the deletion note below.)
- The friends drawer (`components/social/friends-drawer.tsx`) opens from a
  lobby hub tile and owns its own fetch; no state is lifted into
  `poker-app.tsx`. It reuses `.history-overlay`/`.history-drawer` and
  `ProfileAvatar` rather than restating them — `app/styles/21-friends.css`
  holds only list-specific rules.
- Wire types live in `lib/social/types.ts`, not the store: `friends-store.ts`
  is `server-only`, so a client import would drag the service-role client into
  the browser bundle. Same reasoning as `lib/game/table-channel.ts`.
- **No seat-based discovery yet.** The snapshot carries the id, but nothing
  sends a request with it — the seat menu that would is the next slice. The
  drawer renders whatever `/api/friends` returns, so existing friendships and
  pending requests do display; what is missing is any in-app way to *start* a
  request, which is why a new account sees an empty list.
- All four M15/M16 migrations (`hand_archives`, `friends_and_table_invites`,
  `accept_friend_request`, `revoke_archive_hand_from_public`) are now applied
  to the live production Supabase project, pushed one at a time with a
  dry-run and a health check between each. `service_role`'s EXECUTE on
  `archive_hand`/RPCs comes from an independent per-role grant (verified via
  `aclexplode` against production), not from the PUBLIC grant the last
  migration revokes — confirmed before pushing, not assumed. No local
  Postgres/`psql` is available here, so this is still what verified it, not a
  local run; the memory-mode branch is what the 22+ store tests cover.
- The friends routes were live in production (returning 401, not 404) before
  their backing tables existed, so any real registered user opening the
  friends drawer before this push was almost certainly hitting a 500 from
  `friends-store.ts`'s missing-relation error. That is now fixed.
- Bot lifecycle: busted seats are released and reseated at the head of
  `setupHand` via `releaseBustedSeats` — busted *bots* used to stay busted, so
  a table walked 6 → 5 → 4 and stopped. Refill stops at `TABLE_FUNDED_FLOOR`
  (4), not at six: topping every seat up pins the table full forever, which
  deletes short-handed play and makes unbacked bot chips a renewable source of
  Gold on cash-out. Override with `RIVER_TABLE_FUNDED_FLOOR` (tests only).
- Bot identity rotates on every release path and is persisted as
  `Seat.botIdentity`, an index into an 18-strong pool. It must stay persisted:
  `normalizeGameState` used to re-derive a bot's face from `position` on every
  load, which silently reverted any rotation on the next snapshot. Identities
  are seeded from `id:handNumber:position`, never `Math.random()`, because two
  writers race the same seat and must compute the same answer.
- The "AI" seat badge is gone from the felt. The disclosure now lives in the
  Terms of Service, which is at version 2 — that bump re-prompts every existing
  player, deliberately.
- Turn clocks no longer tick through React. `components/table/use-fuse.ts`
  writes `--fuse-duration`/`--fuse-delay` once per turn and CSS animates both
  the seat ring and the action bar; `poker-table.tsx`'s 250ms `clockNow` state,
  which re-rendered the whole table tree 4Hz, is gone.
- Eight-max: geometry only. `SEAT_COUNT` is still 6 and the DB still constrains
  `cash_game_sessions.seat_number` to 1–6. `seatGeometry` is parametric and
  already yields the eight clock positions; `seatWidthFor` now takes a count.
  The feared 10:30-seat/`.table-feed` collision was measured and does not
  exist (D2 in `docs/known-defects.md` is withdrawn); a guard in
  `tests/e2e/table-feed.spec.ts` holds the clearance. The real blockers are
  `SEAT_COUNT`, the `MAX_SEATS` assertion, and the DB seat_number constraint.
- Busted-seat UI (`components/table/action-bar.tsx`) no longer offers a
  "Close seat" button. There never was a separate "Close Seat" concept
  anywhere else in the codebase — this was the only one, and it just forced
  an immediate `next-hand` action rather than waiting out
  `BUSTED_REBUY_GRACE_MS`. The header's persistent "Leave table" button
  already calls `leave-seat` for a seated player (`leaveTable` in
  `poker-app.tsx`), which is the actual, already-working exit; the busted
  branch now renders only the (already gold-styled, via
  `.action-slot-controls .primary-action`) Rebuy/Buy-Gold-to-rebuy button.
  No engine change was needed or made: `setupHand` already marks a busted
  seat `"out"` (skipped from turn order) between hands, and
  `releaseBustedSeats` + `scheduleNextHand`'s `BUSTED_REBUY_GRACE_MS` +
  `dealNextHandIfDue` already auto-advance and auto-reseat a busted human to
  a bot if they let the grace window lapse, all without a UI action —
  `busted-seat.test.ts`/`continuous-table.test.ts` already cover this and
  keep passing. A per-seat "Sat Out" status pill was deliberately not added:
  `83c585d` removed the last per-seat status pill for a real clipping bug the
  day before this note was written, with dedicated e2e coverage
  (`tests/e2e/table-feed.spec.ts`) asserting no seat renders one; `"out"` in
  `SeatStatus` already *is* sat-out and is already wired through
  `inHand`/`canAct`/the seat-dimming `folded` check.
- `createGame` (`lib/game/engine.ts`) now gives each bot seat a randomized
  starting stack via `randomBotStack` — uniform in `[buyIn, buyIn * 3]`,
  snapped to the nearest big blind. The human seat is never randomized. This
  does not touch `TIER_CONFIG` (`minBuyIn === maxBuyIn` per tier is still
  exactly true; a human still buys in for precisely the tier's number) — only
  what a freshly-created bot seat happens to be carrying. `claimSeat` already
  discards whatever a bot seat was holding and resets to the claiming
  player's own paid buy-in, so this cannot leak un-backed bot chips to a
  human. Fixed three tests that had baked in the old uniform-1000-per-seat
  assumption (two hardcoded `6000` chip-conservation totals in
  `engine.test.ts`, now computed dynamically; `betting-round.test.ts`'s
  `allHumanTable()` fixture, which now explicitly pins every seat back to a
  clean `1000 - committed` since it needs a deterministic table and
  `createGame` already posts hand 1's blinds before returning).
- **Vercel's production branch is `main`, not `ui-redesign-foundation`.**
  Pushing to `ui-redesign-foundation` only ever produces a Preview
  deployment — confirmed via the GitHub Deployments API (`environment` field)
  after a push sat live-but-not-live for several minutes. `main` reached its
  current state via a single PR merge (#1) from `ui-redesign-foundation` at
  `b753717`; there was no other divergence. Getting new work on
  `ui-redesign-foundation` in front of players means a PR into `main` (`gh pr
  create --base main --head ui-redesign-foundation`) and merging it, the same
  way #1 did — not a direct push. Verify a deploy actually landed against the
  *Production* environment (`gh api repos/Nikkayowill/poker/deployments`),
  not just that the merge succeeded, and confirm against the live site
  itself (e.g. a route that only exists in the new code, like
  `/api/invites/pending`, flipping from `404` to a real status).
- The four M15/M16 migrations, the friends-drawer scrollbar/spacing polish,
  the busted-seat "Close seat" removal, and randomized bot starting stacks
  are all live on `www.stackchips.app` as of PR #2 (merge commit
  `3285d5c`) — verified against the Production deployment's own status, not
  assumed from the merge alone.
- `claimSeat` (`lib/game/engine.ts`) no longer lets a mid-hand seat claim buy
  into the hand already running. Previously it converted the bot to a human
  but left `holeCards`/`status`/`acted` untouched, so a player who sat down
  on a bot mid-hand inherited its actual cards and turn — including, if the
  bot was the last seat needing to act, an uncontested win off cards they
  never saw dealt. The new occupant is now forced `status = "out"` for the
  rest of that hand (cleared `holeCards`, never in `nextSeat`'s `canAct`
  rotation), with `remaining(state).length === 1` / `wasCurrentTurn` handled
  the same way an ordinary fold is, and returns to `"active"` automatically
  at the next `setupHand`. `action-bar.tsx` shows a "Sat out" status card
  (reusing `.action-slot-status`/`.action-kicker`, not a new per-seat pill —
  see the note below on why one was deliberately removed) whenever
  `game.status === "playing"` and the caller's own seat is `"out"`, which
  given the fix can now only mean "claimed mid-hand, waiting for next deal."
- The reported "multi-human freeze" (a busted human stalling the table with
  other humans seated) and "expired rebuy squatting" did not reproduce.
  `canAct`/`nextSeat` already skip a busted seat within a hand regardless of
  how many humans are at the table (`commit` marks it `"all-in"`, not
  `"active"`, the instant its stack hits zero), and `turn-clock.ts` already
  queues every seated human as a backup clock-advancer rather than electing
  one — a repro test driving a 6-human table through an all-in bust and past
  its `BUSTED_REBUY_GRACE_MS` deadline completed the hand and dealt the next
  one without a stall, and `busted-seat.test.ts`'s existing "does not lose a
  seat per bust" test already covers four *sequential* human busts staying
  funded. If this is still observed live, it likely needs exact repro steps
  (timing, seat count, Supabase vs. memory mode) rather than another look at
  this code path in isolation.
- Bot personality (`lib/game/engine.ts`) is now rolled independently per seat
  via `pickBotPersonality()` (`randomInt`-weighted MANIAC/ROCK/CALLING_STATION
  35/45/20 — "Loose Cannon"/"Table Captain"/"Whale"), not baked onto a fixed
  pool-identity pattern the way it used to be. `botProfiles[]` is identity
  (name/face) only now; personality is a separate axis, called fresh from
  `createGame` and every `restoreBotControl` reseat, so a bot sitting back
  down needn't play like the one that left. The type names weren't renamed —
  `personalityProfiles` and the preflop chart are still keyed on
  `MANIAC`/`ROCK`/`CALLING_STATION` — only the flavor mapping and the
  assignment mechanism changed.
- The actual "boring preflop folding" fix is `trashContinueChance`, a new
  per-personality field on `personalityProfiles`: previously *every*
  personality hard-folded a "trash"-tier hand preflop outside a fixed 5%
  bluff roll, so no archetype ever played a visibly different range. Now that
  gate is `!bluffWindow && !trashContinueRoll`, where `trashContinueRoll`
  reads the *same* `decisionRoll` the bluff gate already consumes (no extra
  `random()` call, so it doesn't shift any downstream draw a seeded test
  depends on) against a personality-specific threshold. Calibrated against a
  new Monte Carlo VPIP test (`lib/game/bot-personality.test.ts`, seeded
  hole cards + seeded decision rolls, fully deterministic) to land ROCK
  ~26%, MANIAC ~45%, CALLING_STATION ~64% — inside the requested 25–35% /
  40–50% / 60%+ bands. `MANIAC` also gets a `shoveEquityDiscount` (reaches
  for all-in with merely-good equity/a strong draw, not just the nuts) and
  `ROCK` a `limperPunishBonus` (raises limps more readily); both are small,
  additive nudges to the existing shove/raise-decision thresholds, not new
  decision paths.
- Table traffic: `TABLE_FUNDED_FLOOR` is 6 now, not 4 — the old floor of 4
  was a blunt cap on bot stacks becoming a renewable Gold-farming source, but
  to a real player two permanently-empty seats reads as a shrinking
  tournament, not a cash table. The actual guardrail moved from *whether* a
  seat refills to *when*: a bot that busts from losing its stack still
  refills the same hand it always has (unaffected), but a **healthy** bot can
  now voluntarily stand up between hands (`BOT_VOLUNTARY_LEAVE_CHANCE` in
  `releaseBustedSeats`, never below 3 funded seats) and its seat then sits
  out — reusing the existing `"out"`/`.seat-muted` dimmed rendering, no new
  UI — until a randomized `Seat.reseatEligibleAt` timestamp
  (`BOT_REENTRY_DELAY_MIN_MS`/`MAX_MS`, ~30s–3min) elapses. `botVoluntaryLeaveChance()`
  is `0` whenever `process.env.VITEST` is set (same guard `logTurn` in
  `game-store.ts` already uses) regardless of its env override, because it
  rolls inside `releaseBustedSeats`, which hundreds of existing tests reach
  indirectly through `setupHand`/`dealNextHandIfDue` — without the guard, an
  unpredictable subset of the whole suite would go flaky the moment any test
  happened to run enough hands to hit the roll. Tests that exercise it set
  `RIVER_BOT_LEAVE_CHANCE` to exactly `0` or `1` (read manually, not via the
  file's usual `Number(...) || default` idiom, since `Number("0") || 0.05`
  would silently discard an explicit "disable this"). Raising the floor
  alone broke one existing test's chip-conservation invariant
  (`engine.test.ts`'s "plays repeated complete hands" — a single bot bust now
  refills immediately instead of only past 2+ busts, minting chips more
  often) — fixed by tracking minted amounts explicitly rather than assuming
  a fixed table total.
- Gold: `creditGold`'s Supabase path (`lib/server/profile-store.ts`) used to
  be a plain read-then-write, unlike `spendGold`'s guarded `spend_gold` RPC —
  a real (pre-existing, not bot-specific) lost-update race under concurrent
  credits, e.g. a rebuy refund racing a cash-out credit. Closed with a new
  `credit_gold` RPC (`supabase/migrations/20260804160000_credit_gold_rpc.sql`)
  mirroring `spend_gold`/`claim_daily_gold`'s exact `SELECT ... FOR UPDATE`
  pattern; `creditGold` now calls it instead of reading then writing. No
  behavior change to the in-memory branch (already single-threaded) or to
  any caller's contract.
- **That `credit_gold` migration shipped its calling code to production
  without ever being applied, and it cost players real Gold for a day.** The
  code that calls the RPC went live in `ba3b5a4`; the migration sat local-only
  until 2026-08-05. In between, `credit_gold` did not exist in the production
  database, so every `creditGold` threw `PGRST202` — and both cash-out paths
  (`app/api/games/[id]/actions/route.ts:114` and `lib/server/game-store.ts:311`)
  swallow that failure by design, so a player leaving a table had their seat
  released, was told `cashedOut: N`, and was credited nothing. The buy-in
  refund paths (`games/route.ts`, `join/route.ts`, `quick-play/route.ts`) lost
  their refunds the same silent way. Now applied and verified: `credit_gold`
  returns 200 for `service_role`, 401 `permission denied` for `anon`, and
  `migration list --linked` shows `local == remote`.
- The lesson is a checklist item, not a one-off: **a migration and the code
  that calls it are one change and must ship together.** Before merging
  anything that adds a `.rpc(...)` call or reads a new table, run
  `supabase migration list --linked` and confirm the backing migration is on
  the remote — a Vercel deploy will happily ship code against a schema that
  does not exist, and a `.catch(() => profile)` will hide it. `npx supabase`
  (no local install needed) with `SUPABASE_ACCESS_TOKEN` from `.env.local` is
  how this project talks to the live project; `supabase/.temp/project-ref`
  holds the ref.
- `supabase/migrations/20260805120000_blackjack_rounds.sql` (the
  `blackjack_rounds` table) is applied to production and verified: the table
  is present, `service_role` reads it, and `anon` gets `42501 permission
  denied`. It was pushed *before* the PR that shipped the routes reading it,
  which is the ordering the point above exists to enforce. Note that
  `supabase db push` printed a wall of `sb-compile-edge-runtime` /
  `main worker has been destroyed` noise around an otherwise successful push
  — that is the CLI's edge-functions component and is unrelated to the SQL;
  confirm against `migration list --linked` and a real query rather than
  reading the push output.
- `supabase/migrations/20260805180000_arcade_rounds.sql` **is applied to
  production** (confirmed via `migration list --linked`, 2026-08-06 — an
  earlier version of this note said pending). `20260806120000_daily_puzzle_
  rounds.sql` is likewise applied and verified (`service_role` 200, `anon`
  401), pushed *before* the code reading it merged, per the checklist above.
- Update this section when scope changes; keep `CLAUDE.md` synchronized.
