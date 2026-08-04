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
- Active slice: M16 — friends and table invites. The friends half is landed
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
- Update this section when scope changes; keep `CLAUDE.md` synchronized.
