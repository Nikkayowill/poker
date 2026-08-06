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
- Mobile PWA launch prep is done and live on production (installable shell,
  safe-area fixes, the Adsterra CSP fix) — see the deploy note further down
  for the exact commit/PR this shipped in. Menu music is done as an *engine*
  (still silent — see its own bullet below for what "done" means there). A
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
  sheet is a mistake, not a shortcut.
- **This is live on `www.stackchips.app` as of PR #16 (merge `fadd507`)** —
  verified against the Production deployment's own `success` status via
  `gh api repos/Nikkayowill/poker/deployments`, and against the live site
  serving what only this release contains: `/brand/stackchips-logo.png`
  returning 200 (it did not exist before), `sw.js` reporting
  `stackchips-shell-v6`, and the signed-out HTML carrying both
  `HIGH ROLLER ARCADE` and `#983fe0`. Not assumed from the merge alone.
- **`app/styles/14-admin.css` is deliberately NOT part of that release.** The
  admin console's borderless pass was written in the same working tree by a
  concurrent session and the user scoped it out of this deploy, so it is
  still uncommitted local work — the *shipped* admin console keeps its old
  bordered `--line`/`--surface` styling and does not read `--brand-*` at all.
  Anyone picking that up should commit it as its own slice rather than
  assume the doc above already covers it.
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
- `MENU_MUSIC_TRACK` is **still null**, and `lib/audio/music-manifest.ts` now
  records the licensing research rather than just the convention: Pixabay is
  the source every existing file in `public/sounds/` came from (the
  `freesound_community-`/`oxidvideos-` prefixes are its uploader handles) and
  is the right place to look; Kevin MacLeod/incompetech is **CC BY**, not
  free-of-attribution, despite being universally mislabelled as such; and
  FreePD, which was the best CC0 answer, shut down in 2025. Dropping a vetted
  file at `public/sounds/menu-theme.mp3` and flipping that one constant is
  still the entire remaining step.
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
- Menu music is now plug-and-play but still silent: `lib/audio/music-
  manifest.ts` + `lib/audio/menu-music.ts` mirror the existing SFX
  architecture (`lib/audio/manifest.ts` + `sound-effects.ts`) exactly —
  cached looping `<audio>`, fade in/out, autoplay-blocked retry on the next
  gesture — but `MENU_MUSIC_TRACK` is `null` by design, the same "no
  verified asset yet" convention `lose`/`timeout`/`time-card` already use in
  the SFX manifest. No royalty-free track was sourced or embedded — that
  needs a real licensed file, which isn't something to fabricate or fetch
  blind. Dropping one at the documented path and flipping that one constant
  is the entire remaining step. Wired into `poker-app.tsx` exactly like the
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
- The house dealer is **Vera** (`lib/arcade/dealer.ts` — name plus
  `dealerLine(phase, outcome)`, in `lib/` because `vitest.config.ts` collects
  only `lib/` and `app/`). The drawing is
  `components/arcade/dealer-avatar.tsx`, inline SVG on the
  `components/card-back-art.tsx` precedent rather than a shipped asset. It is
  deliberately **not** a `ProfileAvatar` wearing some avatar cosmetic id: that
  catalog is player property — bought, or earned via
  `lib/server/avatar-unlocks.ts` — so dressing the house in one would imply
  the dealer is a player and quietly devalue an item somebody ground for.
- That dealer avatar must stay framed as a **face crop**, not a figure. The
  first version drew a whole croupier inside the disc; at the 34px it actually
  renders, the head was ~11px and the visor a green bar across it, reading as
  a smudge beside the photographic `avatarFace()` crops it sits next to. Judge
  any change to it against a real 34px render, not the 64-unit viewBox.
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
  keep them matching.
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
- The six remaining `lib/arcade/games.ts` entries are still
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
  is finished, the switch is two fields" convention `MENU_MUSIC_TRACK` uses. A
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
- Active slice (parked): M16 — friends and table invites. The friends half is landed
  end to end: `lib/server/friends-store.ts`, `/api/friends/*`, and the drawer
  plus lobby tile in `components/social/friends-drawer.tsx`. The table invite
  half now has its read path: `lib/server/table-invite-store.ts` and
  `GET /api/invites/pending`. Still missing: the POST route that sends one
  (and with it the "inviter must be seated here" check), accept/decline, and
  any UI.
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
- Every path that makes a seat human must set `profileId`. `claimSeat` sets it;
  `applyHumanIdentity` in the table-manager adapter *clears* it (that worker
  has only a session token) — it mutates a seat that may still hold the last
  occupant's id, and normalize cannot catch it because the seat is human.
  Worker-run tables therefore cannot add friends, which is the honest answer.
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
