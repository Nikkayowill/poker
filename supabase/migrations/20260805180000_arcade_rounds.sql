-- Server-owned arcade rounds, for every game after the first.
--
-- blackjack_rounds (20260805120000) proved the shape: a jsonb round holding
-- the undealt deck, a version column that is both the concurrency guard and
-- the settlement idempotency key, and one live round per player enforced by a
-- partial unique index. Hi-Lo needs exactly the same three things, and so will
-- the games after it, so this is that table with a `game` discriminator
-- instead of a third and fourth copy.
--
-- blackjack_rounds is deliberately NOT migrated onto this in the same change.
-- It is live, it moves real Gold, and its Supabase path has not yet been
-- exercised by a real hand in production -- rewriting its storage before it
-- has proven itself would put two unverified things on top of each other.
-- Folding it in is a clean follow-up once it has settled some rounds.
--
-- Same posture as every table since the M15 archives: `state` holds the cards
-- a client must never see, so nothing here is granted to anon/authenticated
-- and browsers only ever receive a redacted snapshot from an API route.

create table public.arcade_rounds (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- Free text rather than an enum or a check list: adding a game should be a
  -- new engine and a new route, not a migration. The service role is the only
  -- writer, and the value is always a literal in lib/server, never user input.
  game text not null check (length(game) between 1 and 40),
  -- Optimistic concurrency, same contract as game_state_private.version and
  -- blackjack_rounds.version. Every mutation is an UPDATE ... where version =
  -- <the one the client last saw>, which makes a replayed or double-clicked
  -- action a no-op instead of a second draw from the same deck -- and makes
  -- the settlement credit fire exactly once, since only one UPDATE can match.
  version bigint not null default 1 check (version > 0),
  status text not null default 'active' check (status in ('active', 'settled')),
  tier text not null,
  base_stake integer not null check (base_stake > 0),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.arcade_rounds is
  'Server-owned rounds for the arcade games. state holds undealt cards, so this table is service-role only; browsers receive a redacted snapshot from app/api/arcade/*.';

comment on column public.arcade_rounds.version is
  'Optimistic-concurrency guard and settlement idempotency key: only the caller whose UPDATE matches the expected version may credit the payout.';

-- One live round per player PER GAME, not per player: a player may sit at
-- Hi-Lo and Blackjack at once, and those are different tables in the lounge.
-- Enforced here rather than by a check-then-insert in the route, because two
-- concurrent deals both pass a read-first check after each has already taken
-- a stake.
create unique index arcade_rounds_one_active_per_game
  on public.arcade_rounds(profile_id, game)
  where status = 'active';

create index arcade_rounds_profile_recent_idx
  on public.arcade_rounds(profile_id, created_at desc);

alter table public.arcade_rounds enable row level security;
revoke all on public.arcade_rounds from anon, authenticated;
