-- Sit & Go: a 6-max, human-only, winner-take-all poker tournament. Entry fee
-- and every seat's starting stack are both the chosen stakes tier's own
-- fixed buy-in; blinds escalate on a hand-count schedule; the last seat with
-- chips takes the whole pool. No rebuy, no bot fill, one-shot table.
--
-- Shaped after cribbage_tables/cribbage_table_players
-- (20260818120000_cribbage_tables.sql), the one existing precedent for "an
-- open, joinable, auto-starting table for N humans" -- but this is not a
-- copy, for two reasons specific to this game:
--
--   1. Entry fee is never a client-chosen number the way cribbage's `stake`
--      is. It's always TIER_CONFIG[tier].minBuyIn, so this table stores the
--      TIER as its source of truth (`tier text`, validated against
--      lib/game/tiers.ts's STAKES_TIERS) and derives entry_fee/prize_pool
--      from it -- tier and fee can never disagree, a class of bug cribbage's
--      free-floating stake has to accept.
--
--   2. The actual poker engine (lib/game/engine.ts) authorizes every action
--      by SESSION TOKEN (Seat.ownerToken), not by profile id the way
--      cribbage's own engine does. Registering for a Sit & Go therefore has
--      to persist the registrant's token as well as their profile id, so it
--      can be dropped straight into the dealt game's seats -- see the
--      `token` column below. Storing a raw token in a plain column is not a
--      new exposure class: player_sessions.token and games.owner_token
--      already do exactly this.
--
-- One further structural difference: cribbage's "state" is its own engine
-- state, an inline jsonb column on the same row it's guarded on, so one RPC
-- can guard-and-write it atomically. A Sit & Go's "state" is a real poker
-- GameState, which belongs in the EXISTING games/game_state_private tables
-- (so the existing /api/games/[id]/actions and /advance routes keep working
-- unchanged) -- a second table's row, not this row's own jsonb column. That
-- state can't be written speculatively before the deal guard succeeds
-- (a lost race would orphan a games row), so dealing is two guarded steps
-- instead of cribbage's one: deal_sit_and_go_table flips the table active
-- with no state payload, and only once that succeeds does the service build
-- the GameState and call set_sit_and_go_game_id to record it. See both
-- functions' own comments below.
--
-- Same money-ordering rules as every staked game in this app (see
-- lib/server/sit-and-go-service.ts, which restates them): a stake leaves a
-- wallet before the row it pays for exists, a payout is a single credit of
-- the whole prize pool to the sole winner (no draws), and a pre-deal leave
-- refunds exactly once via a status-guarded write.

create table public.sit_and_go_tables (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  -- The stakes tier chosen at registration. Checked against the exact same
  -- eight strings as lib/game/tiers.ts's STAKES_TIERS -- a ninth tier would
  -- be silently rejected here the same way it would be at every existing
  -- route, per that file's own header comment.
  tier text not null
    check (tier in ('1k', '5k', '10k', '25k', '50k', '100k', '250k', '500k')),
  -- TIER_CONFIG[tier].minBuyIn, denormalized so this table never needs the
  -- app's tier ladder just to answer "how much is this worth" for itself or
  -- for the lobby list.
  entry_fee integer not null check (entry_fee > 0),
  status text not null default 'waiting'
    check (status in ('waiting', 'active', 'completed', 'cancelled')),
  -- Optimistic concurrency, same contract as cribbage_tables.version.
  -- Doubles as the deal guard: dealing bumps this in the same guarded write
  -- that flips status to 'active', so two racing deal attempts cannot both
  -- succeed -- see deal_sit_and_go_table below.
  version bigint not null default 1 check (version > 0),
  -- Null until dealt. The real GameState lives in games/game_state_private,
  -- not here -- see the header comment on why dealing is two guarded steps.
  game_id uuid references public.games(id),
  -- entry_fee * 6, fixed the moment the table deals and never touched again.
  prize_pool integer,
  winner_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  settled_at timestamptz,
  -- 'waiting' always has a null game_id; 'completed' always has a real one.
  -- 'active' and 'cancelled' are BOTH deliberately unconstrained on this
  -- column, for two different reasons: 'active' spans the real gap between
  -- deal_sit_and_go_table (flips status, game_id still null) and
  -- set_sit_and_go_game_id (the second, separate statement that records it)
  -- -- see the header comment on why dealing is two steps rather than one,
  -- and why that gap can rest at 'active'+null for a real, if brief, window.
  -- 'cancelled' covers both a pre-deal leave_sit_and_go_table cancellation
  -- (game_id was never set) and a mid-tournament cancel_stale_sit_and_go_table
  -- one (game_id was already set) -- unlike cribbage, where cancellation only
  -- ever happens pre-deal.
  constraint sit_and_go_tables_game_id_matches_status check (
    (status = 'waiting' and game_id is null)
    or (status = 'completed' and game_id is not null)
    or status in ('active', 'cancelled')
  ),
  -- Same shape as game_id above, but prize_pool has no transient-active gap
  -- to account for: deal_sit_and_go_table sets it in the SAME statement as
  -- status = 'active', so 'active' can stay strictly required. Only
  -- 'cancelled' needs the carve-out, for the same stale-cancel reason.
  constraint sit_and_go_tables_prize_pool_matches_status check (
    (status = 'waiting' and prize_pool is null)
    or (status in ('active', 'completed') and prize_pool is not null)
    or status = 'cancelled'
  ),
  constraint sit_and_go_tables_started_at_matches_status check (
    (status = 'waiting' and started_at is null)
    or (status <> 'waiting' and started_at is not null)
  ),
  constraint sit_and_go_tables_settled_at_matches_status check (
    (status <> 'completed' and settled_at is null)
    or (status = 'completed' and settled_at is not null)
  ),
  constraint sit_and_go_tables_winner_matches_status check (
    (status <> 'completed' and winner_id is null)
    or (status = 'completed' and winner_id is not null)
  )
);

comment on table public.sit_and_go_tables is
  'A Sit & Go registration/lobby row: waiting for its 6th seat, active with a live game_id, or completed/cancelled. The actual poker state lives in games/game_state_private, not here.';

comment on column public.sit_and_go_tables.entry_fee is
  'TIER_CONFIG[tier].minBuyIn, already debited from every registered seat. prize_pool = entry_fee * 6, credited to winner_id exactly once on completion.';

comment on column public.sit_and_go_tables.version is
  'Optimistic concurrency. Doubles as the deal guard (deal_sit_and_go_table) and the settlement guard (the service''s own guarded UPDATE, mirroring advance_cribbage_table''s inline pattern) -- a lost race on either must never pay out or deal twice.';

-- The open-table lobby list: "waiting tables at this tier, newest first."
create index sit_and_go_tables_open_idx
  on public.sit_and_go_tables(tier, created_at desc)
  where status = 'waiting';

-- "What is my own table" -- read after registering, and while waiting.
create index sit_and_go_tables_host_idx
  on public.sit_and_go_tables(host_id, created_at desc);

-- ---------------------------------------------------------------------------
-- One row per registered player. Seat is fixed at registration and carries
-- straight through to the dealt GameState's own seat position.
-- ---------------------------------------------------------------------------

create table public.sit_and_go_table_players (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.sit_and_go_tables(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  seat smallint not null check (seat >= 0 and seat < 6),
  -- The session token this player registered with, so dealing can drop it
  -- straight into the new game's Seat.ownerToken -- the poker engine
  -- authorizes actions by token, not profile id. See the header comment.
  token uuid not null references public.player_sessions(token),
  joined_at timestamptz not null default now(),
  unique (table_id, player_id),
  unique (table_id, seat)
);

comment on column public.sit_and_go_table_players.token is
  'The registrant''s session token at signup time, carried into the dealt GameState''s Seat.ownerToken. Not an authorization check here -- the poker engine is the one thing that ever checks it against an action.';

create index sit_and_go_table_players_table_idx
  on public.sit_and_go_table_players(table_id);

-- "Am I already registered somewhere" -- same narrow, accepted race as
-- cribbage_table_players_player_idx (see that column's own comment):
-- enforced at the application layer, not as a hard per-player constraint.
create index sit_and_go_table_players_player_idx
  on public.sit_and_go_table_players(player_id);

-- ---------------------------------------------------------------------------
-- claim_sit_and_go_seat: atomically assigns the next open seat (0-5) to a
-- registering player, same shape as claim_cribbage_seat with seat < 6
-- instead of < 4, and a token to persist alongside the player id.
-- ---------------------------------------------------------------------------

create or replace function public.claim_sit_and_go_seat(
  p_table_id uuid,
  p_player_id uuid,
  p_token uuid
)
returns table (seat smallint, seated_count integer, host_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_host_id uuid;
  v_seated_count integer;
  v_seat smallint;
begin
  select t.status, t.host_id into v_status, v_host_id
  from public.sit_and_go_tables as t
  where t.id = p_table_id
  for update;

  if v_status is null then
    raise exception 'No such table' using errcode = 'P0002';
  end if;
  if v_status <> 'waiting' then
    raise exception 'That table is no longer taking players' using errcode = 'P0001';
  end if;

  select count(*) into v_seated_count
  from public.sit_and_go_table_players
  where table_id = p_table_id;

  if v_seated_count >= 6 then
    raise exception 'That table is full' using errcode = 'P0001';
  end if;

  -- The lowest OPEN seat, not simply the seated count -- same reasoning as
  -- claim_cribbage_seat: a seat vacated by an earlier leave shouldn't be
  -- collided with by treating the raw count as the next seat number.
  select coalesce(min(s), 0) into v_seat
  from generate_series(0, 5) as s
  where not exists (
    select 1 from public.sit_and_go_table_players
    where table_id = p_table_id and seat = s
  );

  insert into public.sit_and_go_table_players (table_id, player_id, seat, token)
  values (p_table_id, p_player_id, v_seat, p_token);

  return query select v_seat, v_seated_count + 1, v_host_id;
end;
$$;

revoke all on function public.claim_sit_and_go_seat(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_sit_and_go_seat(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- deal_sit_and_go_table: step 1 of 2 for dealing a table. Flips status to
-- 'active' under the same exact-seat-count guard deal_cribbage_table uses
-- (see that function's own comment for why exact, not >=), but carries NO
-- state payload -- unlike cribbage, this table's "state" is a second row in
-- games/game_state_private, and writing that speculatively before this guard
-- succeeds would risk an orphaned games row on a lost race. The caller only
-- builds and persists the real GameState after this step returns
-- successfully, then calls set_sit_and_go_game_id (below) to record it.
--
-- There is no p_require_host/host-early-start path here at all, unlike
-- cribbage: a Sit & Go has no bot fill to cover a short-handed start, so
-- there is exactly one way to fill this table -- wait for all 6 -- and
-- exactly one caller of this function, the join that fills the 6th seat.
-- ---------------------------------------------------------------------------

create or replace function public.deal_sit_and_go_table(
  p_table_id uuid,
  p_expected_seats integer
)
returns public.sit_and_go_tables
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.sit_and_go_tables;
  v_seated_count integer;
begin
  select * into v_row
  from public.sit_and_go_tables
  where id = p_table_id
  for update;

  if v_row.id is null then
    raise exception 'No such table' using errcode = 'P0002';
  end if;
  if v_row.status <> 'waiting' then
    raise exception 'That table has already started' using errcode = 'P0001';
  end if;

  select count(*) into v_seated_count
  from public.sit_and_go_table_players
  where table_id = p_table_id;

  if v_seated_count <> p_expected_seats then
    raise exception 'The table changed -- try again' using errcode = 'P0001';
  end if;

  update public.sit_and_go_tables
  set status = 'active',
      version = version + 1,
      started_at = now(),
      prize_pool = entry_fee * v_seated_count
  where id = p_table_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.deal_sit_and_go_table(uuid, integer) from public, anon, authenticated;
grant execute on function public.deal_sit_and_go_table(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- set_sit_and_go_game_id: step 2 of 2. Records the GameState the service
-- just built and persisted via the existing createStoredGame path. Guarded
-- on game_id still being null, so a retry after a crash between steps 1 and
-- 2 can never overwrite an already-recorded game -- idempotent by construction.
-- ---------------------------------------------------------------------------

create or replace function public.set_sit_and_go_game_id(
  p_table_id uuid,
  p_game_id uuid
)
returns public.sit_and_go_tables
language sql
security definer
set search_path = public
as $$
  update public.sit_and_go_tables
  set game_id = p_game_id
  where id = p_table_id
    and status = 'active'
    and game_id is null
  returning *;
$$;

revoke all on function public.set_sit_and_go_game_id(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_sit_and_go_game_id(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- cancel_empty_sit_and_go_table: unwinds a table whose host could not be
-- seated right after creation, identical in shape to
-- cancel_empty_cribbage_table.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_empty_sit_and_go_table(
  p_table_id uuid,
  p_host_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  delete from public.sit_and_go_tables
  where id = p_table_id
    and host_id = p_host_id
    and status = 'waiting'
    and not exists (
      select 1 from public.sit_and_go_table_players where table_id = p_table_id
    )
  returning true;
$$;

revoke all on function public.cancel_empty_sit_and_go_table(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_empty_sit_and_go_table(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- leave_sit_and_go_table: pre-deal only, identical in shape to
-- leave_cribbage_table (refund happens in TypeScript on a non-null return;
-- host role passes to whoever registered earliest; an empty table cancels).
-- ---------------------------------------------------------------------------

create or replace function public.leave_sit_and_go_table(
  p_table_id uuid,
  p_player_id uuid
)
returns public.sit_and_go_table_players
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_host_id uuid;
  v_left public.sit_and_go_table_players;
  v_new_host uuid;
  v_remaining integer;
begin
  select status, host_id into v_status, v_host_id
  from public.sit_and_go_tables
  where id = p_table_id
  for update;

  if v_status is null or v_status <> 'waiting' then
    return null;
  end if;

  delete from public.sit_and_go_table_players
  where table_id = p_table_id and player_id = p_player_id
  returning * into v_left;

  if v_left.id is null then
    return null;
  end if;

  select count(*) into v_remaining
  from public.sit_and_go_table_players
  where table_id = p_table_id;

  if v_remaining = 0 then
    update public.sit_and_go_tables set status = 'cancelled' where id = p_table_id;
  elsif v_host_id = p_player_id then
    select player_id into v_new_host
    from public.sit_and_go_table_players
    where table_id = p_table_id
    order by seat asc
    limit 1;
    update public.sit_and_go_tables set host_id = v_new_host where id = p_table_id;
  end if;

  return v_left;
end;
$$;

revoke all on function public.leave_sit_and_go_table(uuid, uuid) from public, anon, authenticated;
grant execute on function public.leave_sit_and_go_table(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- cancel_stale_sit_and_go_table: the one RPC with no cribbage precedent.
-- Cribbage has no bot-free "abandoned mid-match" cleanup path at all -- a
-- stuck cribbage table just sits there. A Sit & Go's equivalent path
-- (lib/server/game-store.ts's archiveStaleGames, run against an abandoned
-- table with no recently-seen human) must NOT be allowed to fall through to
-- that function's ordinary per-seat "credit the current stack" refund: doing
-- so would let an abandoned tournament mint each remaining seat's live stack
-- as Gold with no elimination and no single-winner guard ever running -- two
-- colluding seats could push chips to one via soft play, then both go idle,
-- and walk away with more Gold than they ever put in. This function instead
-- version-guards the table straight from 'active' to 'cancelled' (no winner,
-- no prize_pool payout); the caller refunds each seat's ORIGINAL entry_fee
-- from this row, never a live stack, exactly once each.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_stale_sit_and_go_table(
  p_table_id uuid,
  p_expected_version bigint
)
returns public.sit_and_go_tables
language sql
security definer
set search_path = public
as $$
  update public.sit_and_go_tables
  set status = 'cancelled',
      version = version + 1
  where id = p_table_id
    and status = 'active'
    and version = p_expected_version
  returning *;
$$;

revoke all on function public.cancel_stale_sit_and_go_table(uuid, bigint) from public, anon, authenticated;
grant execute on function public.cancel_stale_sit_and_go_table(uuid, bigint) to service_role;

alter table public.sit_and_go_tables enable row level security;
alter table public.sit_and_go_table_players enable row level security;
revoke all on public.sit_and_go_tables from anon, authenticated;
revoke all on public.sit_and_go_table_players from anon, authenticated;
