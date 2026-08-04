# StackChips: proposed M15-M19 architecture

Planning handoff for Claude Code. Most of this is still proposal, with two exceptions:
M15's archive/history server half has landed (`hand_archives`, the `archive_hand` RPC,
`lib/server/hand-archive-store.ts`, `/api/history/*`), and M16's friends half has landed
across two migrations plus `/api/friends/*` and the friends drawer. Table invites, M17–M19,
and every UI not named here remain proposals.

Implement in order; each milestone gets one or more append-only imperative migrations, a
server store with a memory-mode mirror, API tests, and an E2E happy path. One migration per
milestone is the norm, not a rule — M16 needed a second for the `accept_friend_request` RPC
and a third to revoke a default grant. Always add a new migration for a schema change; never
rewrite a migration that has been deployed.

## Fixed rules

- Keep cards, balances, clocks, winners, rewards, and tournament movement server-authoritative.
- Browser Realtime messages are invalidations only; refetch a caller-filtered API response.
- Enable RLS on every new `public` table. Default to no `anon`/`authenticated` table grants; use server-only stores/RPCs.
- Make every event/reward write idempotent. Add FK indexes and explicit retention/deletion behavior.
- Guests can play, but durable social/reward features require `profiles.user_id IS NOT NULL`.
- Before M15, accept Supabase's publishable-key env name alongside the legacy anon-key name; Supabase plans to deprecate legacy keys by the end of 2026.

## M15 - Personal hand history and replay

**Outcome:** A registered player can review prior hands without exposing cards that poker rules kept hidden.

**Schema**

- `hand_archives`: `(game_id, hand_number)` PK, final board, pot, rake, winner summary, action timeline JSONB, final state version, `ended_at`. Do not FK to `games` if history must survive table cleanup.
- `hand_archive_players`: archive key + seat, nullable `profile_id`, display-name snapshot, result/net, hole cards, `cards_were_shown`; unique per archive/seat.

**Hooks**

- Replace the two separate `recordHandStats` call sites with shared `onHandCompleted(state)` after the game write wins.
- `archive_hand(...)` RPC inserts the archive and player rows atomically with `ON CONFLICT DO NOTHING`; stats/unlocks remain retry-safe siblings.
- `GET /api/history` and `/api/history/[gameId]/[hand]` resolve the cookie server-side. Return the caller's cards and only opponents' genuinely shown cards.

**Edges:** timeout/human completion races; next hand overwriting the aggregate; folded and uncontested cards; split pots; deleted profiles; old hands with no archive; cursor pagination and bounded JSON size.

## M16 - Friends and table invites

**Outcome:** Registered players can connect and invite each other to existing private tables.

**Schema**

- `friend_requests(id, requester_id, addressee_id, status, created_at, responded_at)`; **two** partial unique indexes, both `where status = 'pending'`: one on `(requester_id, addressee_id)` stopping a duplicate request in the same direction, and one on `(least(...), greatest(...))` stopping the crossed pair — A asking B while B is asking A, which is a different ordered pair and would otherwise let both be accepted into the same friendship. Partial on status so a declined pair can ask again. Keep both indexes and let a conflicting insert surface as SQLSTATE `23505`; do not replace them with check-then-insert, which cannot see the crossed case without a lock.
- `friendships(profile_low_id, profile_high_id, created_at)`; canonical ordering check + composite PK.
- `profile_blocks(blocker_id, blocked_id, created_at)`; directional PK.
- `table_invites(id, game_id, inviter_id, invitee_id, expires_at, accepted_at, revoked_at)`; index open invites by invitee/expiry.

**Hooks**

- Server routes resolve session cookie -> profile and reject guests. Accepting calls the existing join flow; an invite never grants a seventh seat or bypasses buy-in checks.
- Load counts/invites during lobby bootstrap and refetch on focus. Do not put profile IDs in a public channel. Private per-user Broadcast can be a later optimization only after a verified Auth JWT is available.
- One transaction handles accept/request crossover and block cleanup.

**Edges:** simultaneous cross-requests; self-request; block wins over friendship; full/completed table; expired/revoked invite; inviter leaves; name changes; account deletion; guest later linking an account.

## M17 - Safe table reactions and chat

**Outcome:** Seated players get canned reactions first; short text chat can follow behind a feature flag.

**Schema**

- `table_messages(id, game_id, hand_number, sender_profile_id, sender_seat_id, kind, body, moderation_status, client_nonce, created_at, expires_at)`; unique `(sender_profile_id, client_nonce)` and `(game_id, id)` index.
- `table_message_signals(game_id PK, seq, updated_at)`; contains no message or identity data.

**Hooks**

- `POST /api/games/[id]/messages` verifies the cookie owns a current seat, validates/rate-limits content, then an RPC inserts and increments `seq` atomically.
- A trigger sends public `TABLE_MESSAGES_CHANGED {v, seq}` on `table-messages:<gameId>`; the client refetches a filtered API list. Do not change game `version` or write `game_actions`.
- Apply bans, blocks, escaping, profanity policy, and retention in the server store. Start with allow-listed reaction IDs to lower moderation risk.

**Edges:** XSS/Unicode controls; spam and duplicate nonce; reconnect gaps/out-of-order events; sender leaves; blocked users at the same table; deleted profile; message expiry; reports/evidence retention.

## M18 - Missions, achievements, and idempotent rewards

**Outcome:** Daily/weekly/season/lifetime goals reward play without allowing retries to mint Gold twice.

**Schema**

- `mission_definitions(code PK, cadence, metric, target, reward_gold, rules JSONB, starts_at, ends_at, enabled)`.
- `player_mission_progress(profile_id, mission_code, period_start, progress, completed_at, claimed_at)`; composite PK.
- `reward_grants(idempotency_key PK, profile_id, source, gold_amount, created_at)`; immutable audit ledger.

**Hooks**

- Emit stable domain event IDs from `onHandCompleted`, cash-session settlement, and cosmetic purchase. `apply_mission_event(...)` updates progress once.
- `claim_mission(...)` locks progress/profile, records `reward_grants`, and credits Gold in one transaction.
- Compute UTC period keys server-side. Cron may activate/expire definitions, but normal progress never depends on Cron running.

**Edges:** duplicate/reordered events; UTC boundary; private-table collusion; bot-only hands; unlimited-Gold accounts; season rollover; disabled mission mid-period; refund/admin adjustment; profile deletion.

## M19 - Sit-and-go tournaments, then multi-table

**Outcome:** Ship one-table six-player sit-and-go first; retain schema seams for later table balancing.

**Schema**

- `tournaments(id, status, starts_at, registration_closes_at, buy_in, max_players, starting_stack, payout JSONB, version)`.
- `tournament_levels(tournament_id, level_no, small_blind, big_blind, ante, duration_seconds)`.
- `tournament_entries(tournament_id, profile_id, status, stack, game_id, seat_number, finish_place, joined_at)`; one entry per player.
- `tournament_tables(tournament_id, game_id, status)`; `tournament_events(tournament_id, seq, kind, payload, created_at)`; `tournament_payouts(tournament_id, profile_id, place, gold, status)`.

**Hooks**

- `register_tournament(...)` locks capacity and Gold together; cancellation/refund and payout RPCs use immutable idempotency keys.
- A Node orchestrator creates ordinary authoritative game aggregates. `onHandCompleted` checkpoints stacks/eliminations; rebuy, cash-out, rake, and bot seat claims are disabled for tournament tables.
- Supabase Cron may mark registration/start/level deadlines due, but never chooses cards or player actions. Existing seated-browser `/advance` clocks still run hands.
- Balance multi-table seats only between hands and persist tournament event + source/destination assignments atomically.

**Edges:** too few entrants/cancellation; simultaneous busts and finish order; split pots; odd table counts; AFK/disconnect; late registration policy; blind increase during a hand; deploy downtime; payout retry; collusion; spectator/card privacy.

## Delivery gates

For each milestone: append (never rewrite) a migration; run Supabase security/performance advisors; test RLS/grants and idempotency; verify memory/Supabase parity; then run `npm test`, `npm run lint`, `npm run build`, and the milestone E2E flow.

Supabase references: [Broadcast](https://supabase.com/docs/guides/realtime/broadcast), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Cron](https://supabase.com/docs/guides/cron), [breaking changes](https://supabase.com/changelog?types=breaking-change).
