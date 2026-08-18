-- Cribbage: a 3-4 player free-for-all, Gold-wagered table. First to 121
-- takes the whole pot -- no partnerships, no house, no rake.
--
-- This is NOT built on pvp_matches/pvp_challenges. That pair is 2-player at
-- every layer -- player0_id/player1_id fixed columns, a winner_seat smallint
-- checked to (0, 1), a trigger written specifically for two ordered columns
-- -- and none of it generalizes to 3-4 seats. Cribbage gets its own two
-- tables instead, shaped after the one existing precedent in this codebase
-- for "N humans at one row": game_seats (20260726121703_multiplayer_rooms).
--
-- The lifecycle is also genuinely different from a duel's challenge/accept
-- pair, so it is not modelled as one. There is no offer one specific person
-- accepts -- there is a table anyone can join, that fills to 4 or is
-- started early by its host once 3 are seated. Two tables instead:
--
--   cribbage_tables        -- one row per table: stake, status, the whole
--                              game state once dealt, who won.
--   cribbage_table_players -- one row per seated player, fixing their seat
--                              (and so their pegging/dealer turn order) the
--                              moment they join.
--
-- Same money-ordering rules as every staked game in this app (see
-- lib/server/cribbage-service.ts, which restates them): a stake leaves a
-- wallet before the seat/table row it pays for exists, a payout is a single
-- credit of the whole pot to the sole winner (cribbage has no draws), and a
-- leave-before-start refund happens exactly once via a status-guarded write.
--
-- `state` holds every seat's hidden hand and the crib until they are
-- revealed, same posture as pvp_matches: service-role only, nothing granted
-- to anon or authenticated. Browsers only ever see a per-viewer redacted
-- snapshot from app/api/cribbage/, never a row.

create table public.cribbage_tables (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  -- Per seat, matching MIN_DUEL_STAKE's floor (lib/pvp/match-contract.ts) --
  -- cribbage is duel-shaped money-wise (winner-take-all, no house), just
  -- with 3-4 payers instead of 2, so it reuses the same floor rather than
  -- inventing a second one.
  stake integer not null check (stake > 0),
  status text not null default 'waiting'
    check (status in ('waiting', 'active', 'completed', 'cancelled')),
  -- Optimistic concurrency, same contract as pvp_matches.version: every
  -- mutation past the deal is an UPDATE ... where version = <last seen>.
  -- Also the transition guard FROM 'waiting': dealing sets it from 1 to 2 in
  -- the same guarded write that flips status, so two racing attempts to
  -- deal the same table (an auto-start racing a host-start) cannot both
  -- succeed -- see deal_cribbage_table below.
  version bigint not null default 1 check (version > 0),
  -- Null while waiting: there is no CribbageState until the table deals.
  state jsonb check (state is null or jsonb_typeof(state) = 'object'),
  winner_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  settled_at timestamptz,
  constraint cribbage_tables_state_matches_status check (
    (status in ('waiting', 'cancelled') and state is null)
    or (status in ('active', 'completed') and state is not null)
  ),
  constraint cribbage_tables_started_at_matches_status check (
    (status in ('waiting', 'cancelled') and started_at is null)
    or (status in ('active', 'completed') and started_at is not null)
  ),
  constraint cribbage_tables_settled_at_matches_status check (
    (status <> 'completed' and settled_at is null)
    or (status = 'completed' and settled_at is not null)
  ),
  constraint cribbage_tables_winner_matches_status check (
    (status <> 'completed' and winner_id is null)
    or (status = 'completed' and winner_id is not null)
  )
);

comment on table public.cribbage_tables is
  'A cribbage table: waiting for players, an active deal in progress, or completed/cancelled. state holds every seat''s hidden hand and the crib, so this is service-role only.';

comment on column public.cribbage_tables.stake is
  'Gold ANTE PER SEAT, already debited from every seated player. The pot is stake * (seat count), credited to winner_id exactly once on completion.';

comment on column public.cribbage_tables.version is
  'Optimistic concurrency, same contract as pvp_matches.version. Doubles as the deal guard: the transition out of ''waiting'' is itself a version-guarded write, so an auto-start racing a host-start can only deal the table once.';

-- The open-table lobby list: "waiting tables at this stake, newest first."
create index cribbage_tables_open_idx
  on public.cribbage_tables(stake, created_at desc)
  where status = 'waiting';

-- "What is my own table" -- read after acting, and for the host-start button.
create index cribbage_tables_host_idx
  on public.cribbage_tables(host_id, created_at desc);

-- ---------------------------------------------------------------------------
-- One row per seated player. The seat number is fixed at join time and never
-- changes -- it is what defines pegging and dealer turn order for the whole
-- match, the same way pvp_matches.player0_id/player1_id fix who is "seat 0"
-- for a duel's whole life.
-- ---------------------------------------------------------------------------

create table public.cribbage_table_players (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.cribbage_tables(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  seat smallint not null check (seat >= 0 and seat < 4),
  joined_at timestamptz not null default now(),
  unique (table_id, player_id),
  unique (table_id, seat)
);

comment on table public.cribbage_table_players is
  'One row per seated player, fixing their seat (and so their pegging/dealer order) the moment they join. Deleting a row here (leave_cribbage_table) is only legal pre-deal -- an active or completed table''s seats are permanent.';

create index cribbage_table_players_table_idx
  on public.cribbage_table_players(table_id);

-- "Am I already seated somewhere" -- the join-guard read in
-- lib/server/cribbage-service.ts. NOT a hard constraint the way pvp_matches'
-- one-active-match trigger is: expressing "one non-terminal table per
-- player" as an index would need this table to see cribbage_tables.status,
-- which a partial index's predicate cannot reference across tables without
-- denormalizing status onto every seat row. Enforced at the application
-- layer instead, which accepts a narrow race (two joins landing in the same
-- instant could seat one player at two tables) -- a real but low-severity
-- gap: unlike a duel, one table's pot math never depends on what other
-- tables a player happens to be seated at, so this cannot lose or duplicate
-- anyone's Gold, only double-lock some of it under a rare race.
create index cribbage_table_players_player_idx
  on public.cribbage_table_players(player_id);

-- ---------------------------------------------------------------------------
-- claim_cribbage_seat: atomically assigns the next open seat (0-3) to a
-- joining player. The row lock on the table is what makes two players
-- joining in the same instant get different seats rather than colliding --
-- the same job pvp_matches_enforce_one_active's FOR UPDATE does there.
-- ---------------------------------------------------------------------------

create or replace function public.claim_cribbage_seat(
  p_table_id uuid,
  p_player_id uuid
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
  from public.cribbage_tables as t
  where t.id = p_table_id
  for update;

  if v_status is null then
    raise exception 'No such table' using errcode = 'P0002';
  end if;
  if v_status <> 'waiting' then
    raise exception 'That table is no longer taking players' using errcode = 'P0001';
  end if;

  select count(*) into v_seated_count
  from public.cribbage_table_players
  where table_id = p_table_id;

  if v_seated_count >= 4 then
    raise exception 'That table is full' using errcode = 'P0001';
  end if;

  -- The lowest OPEN seat, not simply the seated count: a seat vacated by an
  -- earlier leave_cribbage_table call is a real gap, and a joiner assigned
  -- `v_seated_count` there would collide with whoever already holds that
  -- seat number (memory branch) or fail the unique(table_id, seat)
  -- constraint outright, misreporting a genuinely open table as full to the
  -- very next joiner.
  select coalesce(min(s), 0) into v_seat
  from generate_series(0, 3) as s
  where not exists (
    select 1 from public.cribbage_table_players
    where table_id = p_table_id and seat = s
  );

  insert into public.cribbage_table_players (table_id, player_id, seat)
  values (p_table_id, p_player_id, v_seat);

  return query select v_seat, v_seated_count + 1, v_host_id;
end;
$$;

revoke all on function public.claim_cribbage_seat(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_cribbage_seat(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- deal_cribbage_table: the ONE transition out of 'waiting'. Both the auto-
-- start on a 4th join and the host's manual start once 3 are seated call
-- this same function, so there is exactly one code path that can deal a
-- hand into existence -- see the header on lib/server/cribbage-table-store.ts.
--
-- The CribbageState itself (p_state) is computed in TypeScript before this
-- is called -- dealing, shuffling and scoring rules have no business being
-- reimplemented in SQL. This function's whole job is the atomic guard: the
-- table must still be 'waiting', the ACTUAL seated count under this row's
-- lock must exactly match p_expected_seats (the count the caller built
-- p_state for), and -- for a host-initiated early start -- the caller must
-- actually be the host.
--
-- Exact match, not merely "at least min_seats": a >= check has a real race
-- in it. A player could join (filling what the caller read as a 3-seat
-- table to 4) in the gap between the caller reading the seat count and this
-- call landing -- a >= 3 guard would still pass and persist a 3-player
-- CribbageState while a 4th seat row (and a 4th debited stake) exists, and
-- that player's Gold would be stranded forever (every move they send is
-- rejected as an out-of-range seat, and leaving is pre-deal only). Requiring
-- the count to match exactly what the state was actually built for turns any
-- such change -- a join OR a leave -- into a clean guard failure instead: a
-- failed guard raises, so the computed state that was thrown away is exactly
-- that, thrown away, nothing was ever persisted, no compensation needed.
-- ---------------------------------------------------------------------------

create or replace function public.deal_cribbage_table(
  p_table_id uuid,
  p_actor_id uuid,
  p_require_host boolean,
  p_expected_seats integer,
  p_state jsonb
)
returns public.cribbage_tables
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.cribbage_tables;
  v_seated_count integer;
begin
  select * into v_row
  from public.cribbage_tables
  where id = p_table_id
  for update;

  if v_row.id is null then
    raise exception 'No such table' using errcode = 'P0002';
  end if;
  if v_row.status <> 'waiting' then
    raise exception 'That table has already started' using errcode = 'P0001';
  end if;
  if p_require_host and v_row.host_id <> p_actor_id then
    raise exception 'Only the host can start this table early' using errcode = 'P0001';
  end if;

  select count(*) into v_seated_count
  from public.cribbage_table_players
  where table_id = p_table_id;

  if v_seated_count <> p_expected_seats then
    raise exception 'The table changed -- try again' using errcode = 'P0001';
  end if;

  update public.cribbage_tables
  set status = 'active',
      state = p_state,
      version = version + 1,
      started_at = now()
  where id = p_table_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.deal_cribbage_table(uuid, uuid, boolean, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.deal_cribbage_table(uuid, uuid, boolean, integer, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- cancel_empty_cribbage_table: unwinds a table whose host could not be
-- seated right after creation (a transient failure between
-- create_cribbage_table_row and claim_cribbage_seat). Guarded to a table
-- that is still 'waiting' with genuinely zero seated players, so it can
-- never touch a table anyone has actually joined or staked into.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_empty_cribbage_table(
  p_table_id uuid,
  p_host_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  delete from public.cribbage_tables
  where id = p_table_id
    and host_id = p_host_id
    and status = 'waiting'
    and not exists (
      select 1 from public.cribbage_table_players where table_id = p_table_id
    )
  returning true;
$$;

revoke all on function public.cancel_empty_cribbage_table(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_empty_cribbage_table(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- leave_cribbage_table: pre-deal only. Removes the leaver's own seat (their
-- refund is handled by the caller, in TypeScript, once this returns a row --
-- same "only a returned row is refunded" discipline cancelDuelChallenge
-- keeps). If the leaver was the host, hands the host role to whoever seated
-- earliest among those remaining rather than cancelling a table other
-- players have already staked into. If nobody is left, the table itself is
-- cancelled -- an empty 'waiting' table has nothing left to fill it.
-- ---------------------------------------------------------------------------

create or replace function public.leave_cribbage_table(
  p_table_id uuid,
  p_player_id uuid
)
returns public.cribbage_table_players
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_host_id uuid;
  v_left public.cribbage_table_players;
  v_new_host uuid;
  v_remaining integer;
begin
  select status, host_id into v_status, v_host_id
  from public.cribbage_tables
  where id = p_table_id
  for update;

  if v_status is null or v_status <> 'waiting' then
    return null;
  end if;

  delete from public.cribbage_table_players
  where table_id = p_table_id and player_id = p_player_id
  returning * into v_left;

  if v_left.id is null then
    return null;
  end if;

  select count(*) into v_remaining
  from public.cribbage_table_players
  where table_id = p_table_id;

  if v_remaining = 0 then
    update public.cribbage_tables set status = 'cancelled' where id = p_table_id;
  elsif v_host_id = p_player_id then
    select player_id into v_new_host
    from public.cribbage_table_players
    where table_id = p_table_id
    order by seat asc
    limit 1;
    update public.cribbage_tables set host_id = v_new_host where id = p_table_id;
  end if;

  return v_left;
end;
$$;

revoke all on function public.leave_cribbage_table(uuid, uuid) from public, anon, authenticated;
grant execute on function public.leave_cribbage_table(uuid, uuid) to service_role;

alter table public.cribbage_tables enable row level security;
alter table public.cribbage_table_players enable row level security;
revoke all on public.cribbage_tables from anon, authenticated;
revoke all on public.cribbage_table_players from anon, authenticated;
