# StackChips security audit

Audited 2026-07-26 against the application migrations, server routes, runtime
configuration, and the live Supabase project `gykxzlqwkraiflbfxtps`.

## Result

The game is server-authoritative. Browser code receives the public Supabase URL
and anonymous key only. The service-role key is read exclusively by server-only
modules, and production refuses to start with a partial Supabase
configuration.

The live project has RLS enabled on all seven application tables:
`player_sessions`, `profiles`, `games`, `game_seats`, `game_state_private`,
`game_actions`, and `game_signals`. The `anon` and `authenticated` roles have
no table privileges except `SELECT` on `game_signals`. That signal contains
only an opaque game UUID, version, and timestamp. Realtime publishes only that
table—not the private aggregate containing the deck and hole cards.

`persist_game_action` is callable only by `service_role`, uses an empty
`search_path`, requires an exact version transition, and atomically persists
the aggregate, public seat balances, action ledger, and Realtime signal.

## Requirement mapping

| Requirement | Enforcement |
| --- | --- |
| A player cannot update chip balances or the pot | No browser write grants or RLS write policies. Only the Next.js server runs the engine and service-role persistence RPC. |
| A player cannot select another hand | `game_state_private` has no browser privileges. `toSnapshot` reveals hole cards only to the seat owner, or at a genuine showdown when poker rules require showing. |
| A player cannot act for another user | Every action resolves the HttpOnly `river_session` cookie to an owned seat; the engine rejects non-owners and out-of-turn actors. |
| A player cannot bypass a full table | Seat claims are checked server-side, constrained to one seat number per table, and persisted with optimistic concurrency. The seventh isolated-browser test receives HTTP 409. |
| A player cannot pick a winner or alter blinds | Neither is accepted as an API action. Showdown, payouts, blinds, betting state, and deck progression are calculated in `lib/game/engine.ts`. |
| A private room cannot be read without authorization | The read route now returns HTTP 403 unless the requesting session owns a seat. Invite-code joining establishes that ownership before opening the table. |
| Client chip amounts are validated | The only client amount is a proposed raise-to value. The engine floors it and checks current bet, stack, all-in exception, and minimum raise before persistence. |
| Service credentials stay private | `SUPABASE_SERVICE_ROLE_KEY` is referenced only by `server-only` modules and is never prefixed `NEXT_PUBLIC_`. Errors do not print keys or environment values. |

## Storage

The avatar bucket is intentionally public for image delivery, limited to 2 MiB
and PNG/JPEG/WebP/GIF. There are no browser upload policies. Uploads pass through
the server endpoint, which validates image bytes and writes with the service
role.

## Changes made during this audit

- Added defense-in-depth privilege revocation in
  `20260726140816_restrict_data_api_privileges.sql`.
- Preserved anonymous/authenticated `SELECT` only on safe Realtime invalidation
  signals.
- Added private-room authorization to `GET /api/games/[id]`.
- Added isolated-browser tests for unauthorized reads, full tables, per-player
  private cards, and server-owned action progression.

## Remaining operational controls

- Rotate the service-role key immediately if it is ever pasted into a client,
  issue, screenshot, or log.
- Keep production logs access-controlled and configure retention/alerting at
  the hosting provider.
- Re-run the Supabase security/performance advisors after every schema change.
- Treat public avatar URLs as public content; never store personal or secret
  files in the avatar bucket.
