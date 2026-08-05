-- Server-owned Blackjack rounds.
--
-- Until now the arcade table dealt in the browser and settled nothing: a
-- client that owns the deck can report whatever result it likes, so the round
-- was play-money and said so on the felt. This table is what lets the server
-- own the deck instead, so a round can move real Gold under CLAUDE.md's first
-- rule.
--
-- `state` is the whole BlackjackRound from lib/arcade/blackjack.ts, INCLUDING
-- the undealt deck. That is the point of storing it server-side, and it is
-- also why nothing here is granted to anon/authenticated: the browser gets
-- toBlackjackSnapshot()'s redacted view (no deck, no hole card during the
-- player's turn) from an API route, never a row from this table.
--
-- The round survives a page refresh and a lambda cold start on purpose. An
-- in-memory round would be lost the moment a hit landed on a different
-- instance from the deal, which with a debited stake means a player paying
-- for a hand that then evaporates.

create table public.blackjack_rounds (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- Optimistic concurrency, same contract as game_state_private.version.
  -- Every mutation is an UPDATE ... where version = <the one the client last
  -- saw>, which is what makes a replayed or double-clicked action a no-op
  -- rather than a second deal from the same deck. It is also the payout's
  -- idempotency key: exactly one caller can win the race that flips a round
  -- to 'settled', so exactly one credit_gold can fire for it.
  version bigint not null default 1 check (version > 0),
  status text not null default 'active' check (status in ('active', 'settled')),
  tier text not null,
  -- What the round opened for. The doubled figure lives in `state.stake`;
  -- this stays the opening wager so the settled row still records what the
  -- player originally sat down for.
  base_stake integer not null check (base_stake > 0),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.blackjack_rounds is
  'Server-owned Blackjack rounds. state holds the undealt deck, so this table is service-role only; browsers receive a redacted snapshot from app/api/arcade/blackjack.';

comment on column public.blackjack_rounds.version is
  'Optimistic-concurrency guard. Doubles as the settlement idempotency key: only the caller whose UPDATE matches the expected version may credit the payout.';

-- One live round per player, enforced in the database rather than by a
-- check-then-insert in the route -- two concurrent deals would both pass a
-- read-first check and both debit a stake. Partial on status so a player's
-- settled history does not block their next deal.
create unique index blackjack_rounds_one_active_per_profile
  on public.blackjack_rounds(profile_id)
  where status = 'active';

create index blackjack_rounds_profile_recent_idx
  on public.blackjack_rounds(profile_id, created_at desc);

-- Same posture as the M15 archive and M16 friends tables: RLS on with no
-- policies and no grants. Every read and write goes through an API route
-- holding the service role, which authorises the caller from their
-- river_session cookie. RLS is enabled anyway so that a later grant cannot
-- silently expose whole rows -- with RLS on and no policy, a grant alone
-- still returns nothing.
alter table public.blackjack_rounds enable row level security;
revoke all on public.blackjack_rounds from anon, authenticated;
