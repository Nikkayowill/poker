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
- Active slice: M15 — personal hand history and replay.
- State: M12, M13, M14a and M14b are landed and verified. M15's server half is
  in the working tree: the `hand_archives`/`hand_archive_players` migration,
  `archive_hand` RPC, `lib/server/hand-archive-store.ts`, and the two
  `/api/history` routes. No history UI yet — nothing in `components/` reads
  these routes.
- Two supporting changes landed with it: `lib/server/hand-completion.ts` is now
  the single post-hand hook (it replaced two drifted `recordHandStats` call
  sites, one of which never checked avatar unlocks), and
  `lib/supabase/public-env.ts` accepts Supabase's publishable-key env name
  alongside the legacy anon-key name.
- Update this section when scope changes; keep `CLAUDE.md` synchronized.
