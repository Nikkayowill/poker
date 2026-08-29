# StackChips security audit

## Audit scope and date

The audit date is 2026-07-26. The audit team audited four items:

- the application migrations
- the server routes
- the runtime configuration
- the live Supabase project `gykxzlqwkraiflbfxtps`

## Stale and scope warning — read this first

**This audit is stale. This audit covers the seven original poker tables
only.**

The information below shows the state on the 2026-07-26 audit date. The
team did not repeat the audit after that date.

The app grew much larger after the audit date. This document does not
cover many new app parts. This document does not cover several
money-moving surfaces.

The uncovered money-moving surfaces are:

- Stripe: table `stripe_payments`, table `stripe_subscriptions` (one-time
  support, monthly support, and Gold purchase)
- PvP duel escrow: table `pvp_challenges`, table `pvp_matches`
- cribbage tables: table `cribbage_tables`, table `cribbage_table_players`
- Sit & Go tournaments: table `sit_and_go_tables`, table
  `sit_and_go_table_players`
- Ante Up wagers: table `ante_up_attempts`
- Blackjack, arcade, and daily-puzzle round tables: table
  `blackjack_rounds`, table `arcade_rounds`, table `daily_puzzle_rounds`
- Gold economy and progression tables: table `player_cosmetics`, table
  `player_progression`, table `mission_*`, table `achievement_*`, table
  `rewarded_ad_grants`
- leaderboards and head-to-head records
- friends, table-invite, and blocking tables: table `friend_requests`,
  table `friendships`, table `profile_blocks`, table `table_invites`,
  table `friend_invite_codes`
- hand archives
- Web Push subscriptions: table `push_subscriptions`

Treat this file as historical background only. This file describes the
original seven-table design only. This file is not a report on the
current security state.

Query the live project directly to check Row Level Security (RLS) and
privileges on any item above. Do not use this document for that check.

## Result

The server is authoritative for the game. The browser code receives only
the public Supabase URL and the anonymous key.

Only `server-only` modules read the service-role key. Production does not
start with a partial Supabase configuration.

The live project enables RLS on seven application tables:

- table `player_sessions`
- table `profiles`
- table `games`
- table `game_seats`
- table `game_state_private`
- table `game_actions`
- table `game_signals`

The role `anon` and the role `authenticated` have no table privileges.
Each role has one exception: `SELECT` on table `game_signals`.

The table `game_signals` contains only three fields:

- an opaque game universally unique identifier (UUID)
- a version number
- a timestamp

Realtime publishes only the table `game_signals`. Realtime does not
publish the private aggregate. The private aggregate contains the deck
and the hole cards.

Only the role `service_role` can call the remote procedure call (RPC)
`persist_game_action`. The RPC `persist_game_action` uses an empty
`search_path`. The RPC `persist_game_action` needs an exact version
transition.

The RPC `persist_game_action` writes four items as one atomic operation:

- the aggregate
- the public seat balances
- the action ledger
- the Realtime signal

## Requirement mapping

| Requirement | Enforcement |
| --- | --- |
| A player cannot update chip balances or the pot | The browser has no write grants. The browser has no RLS write policies. Only the Next.js server runs the engine and the service-role persistence RPC. |
| A player cannot select another hand | The table `game_state_private` has no browser privileges. The function `toSnapshot` reveals the hole cards to the seat owner only. The function `toSnapshot` also reveals the hole cards at a genuine showdown. Poker rules require the showdown reveal. |
| A player cannot act for another user | Every action resolves the HttpOnly cookie `river_session` to an owned seat. The engine rejects non-owners. The engine rejects out-of-turn actors. |
| A player cannot bypass a full table | The server checks seat claims on the server side. The server allows one seat number per table. The server persists seat claims with optimistic concurrency control. The seventh isolated-browser test receives the Hypertext Transfer Protocol (HTTP) status code 409. |
| A player cannot pick a winner or alter blinds | The API (application programming interface) does not accept either action. The file `lib/game/engine.ts` calculates these items:<br>- the showdown<br>- the payouts<br>- the blinds<br>- the betting state<br>- the deck progression |
| A private room cannot be read without authorization | The read route returns the HTTP status code 403 for a session with no seat. Invite-code joining gives the player seat ownership. The table opens after that. |
| The server validates client chip amounts | The only client amount is a proposed raise-to value. The engine floors the raise-to value. The engine checks four items before persistence:<br>- the current bet<br>- the stack<br>- the all-in exception<br>- the minimum raise |
| Service credentials stay private | Only `server-only` modules reference the environment variable `SUPABASE_SERVICE_ROLE_KEY`. The variable name never starts with the prefix `NEXT_PUBLIC_`. Error messages do not print keys or environment values. |

## Storage

The avatar bucket is intentionally public for image delivery. The bucket
has a 2 MiB (mebibyte) size limit. The bucket accepts these image types:

- PNG (Portable Network Graphics)
- JPEG (Joint Photographic Experts Group)
- WebP
- GIF (Graphics Interchange Format)

The bucket has no browser upload policies. Uploads pass through the
server endpoint. The server endpoint validates the image bytes. The
server endpoint writes the file with the role `service_role`.

## Changes made during this audit

- The audit team added defense-in-depth privilege revocation in the
  migration `20260726140816_restrict_data_api_privileges.sql`.
- The audit team kept `SELECT` access for the role `anon` and the role
  `authenticated` on safe Realtime invalidation signals only.
- The audit team added private-room authorization to the route
  `GET /api/games/[id]`.
- The audit team added isolated-browser tests for four cases:
  - unauthorized reads
  - full tables
  - per-player private cards
  - server-owned action progression

## Remaining operational controls

- Rotate the service-role key at once after any of these events:
  - the key appears in a client
  - the key appears in an issue
  - the key appears in a screenshot
  - the key appears in a log
- Keep production logs access-controlled.
- Configure log retention and alerting at the hosting provider.
- Run the Supabase security advisor again after every schema change.
- Run the Supabase performance advisor again after every schema change.
- Treat public avatar URLs as public content.
- Never store personal files in the avatar bucket.
- Never store secret files in the avatar bucket.
