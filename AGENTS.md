# StackChips — Codex Guide

## Stack

StackChips (`stackchips.app`). Next.js 16 App Router, React 19, strict TypeScript, Supabase, Stripe, Sentry. Six-max server-authoritative Hold'em; memory persistence is the no-env fallback.

## Architecture

`browser UI -> app/api -> game engine -> server stores -> memory | Supabase`

- `app/`: pages, Node route handlers, global CSS imports.
- `components/`: client orchestration and lobby/table/profile/store UI.
- `lib/game/`: pure rules, timers, evaluator, snapshots, shared types.
- `lib/server/`: persistence, sessions, profiles, economy, admin; server-only.
- `lib/supabase/`: browser/auth and SSR clients.
- `supabase/migrations/`: ordered imperative schema/RLS/RPC history.
- `tests/e2e/`: Playwright flows; colocated `*.test.ts`: Vitest units.
- `public/`: shipped assets; `art/`: source masters.

Realtime is invalidation only: clients receive a version signal, then refetch a caller-filtered API snapshot. Clients send intents; the engine owns cards, bets, clocks, bots, pots, and payouts.

## Core entry points

- UI shell: `app/layout.tsx`, `app/page.tsx`, `components/poker-app.tsx`
- Main views: `components/lobby/lobby.tsx`, `components/table/poker-table.tsx`
- Game HTTP: `app/api/games/route.ts`, `app/api/games/join/route.ts`, `app/api/games/[id]/{route,actions/route,advance/route}.ts`
- Rules/contracts: `lib/game/engine.ts`, `lib/game/types.ts`, `lib/game/evaluator.ts`
- Persistence: `lib/server/game-store.ts`, `lib/server/profile-store.ts`, `lib/server/supabase-admin.ts`
- Auth/session: `middleware.ts`, `lib/server/session.ts`, `lib/auth/client.ts`
- Realtime: `lib/game/table-channel.ts`, `components/poker-app.tsx`
- Schema/config: `supabase/migrations/`, `supabase/config.toml`, `.env.example`
- Styling: `app/globals.css`; numbered imports are cascade order.
- Ops/docs: `next.config.ts`, `instrumentation*.ts`, `vercel.json`, `docs/`

## Guardrails

- Keep game mutation server-side; never trust client cards, balances, clocks, or winners.
- Keep `GET /api/games/[id]` read-only; writes use optimistic version checks.
- Never expose `SUPABASE_SERVICE_ROLE_KEY`; preserve RLS and filtered snapshots.
- Add a new migration; do not rewrite deployed migration history.
- Preserve numbered CSS import order. Add regression tests for rule/layout changes.
- Treat `river_*` cookies/module names and Sentry slugs as legacy compatibility IDs, not branding; migrate deliberately.
- Do not touch unrelated user changes; `.claude/` may be locally untracked.

## Commands

`npm run dev` · `npm test` · `npm run test:e2e` · `npm run lint` · `npm run build`

## Active milestone

- Track: `ui-redesign-foundation`
- Active slice: M16 — friends and table invites (schema landed, no routes/UI yet).
- State: M12–M15 landed. M15's server half (hand archives, `archive_hand` RPC,
  `/api/history` routes) is unchanged and still has no UI reading it.
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
- M16 migration `20260804120000_friends_and_table_invites.sql` is written but
  has NOT been applied or verified against a live Postgres.
- Update this section when scope changes; keep `CLAUDE.md` synchronized.
