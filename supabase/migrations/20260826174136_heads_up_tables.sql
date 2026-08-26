-- Heads-up poker: a 2-player, Gold-wagered match played on the same engine
-- and the same routes as an ordinary poker table -- hand after hand, button
-- alternating, fixed blinds, until one player is out of chips and the
-- winner takes both stacks. No rebuy, no bots.
--
-- This is NOT the real poker table state -- that lives in games/
-- game_state_private exactly like any other table (lib/game/engine.ts's
-- createHeadsUpGame builds an ordinary GameState with tournament set, and
-- lib/server/game-store.ts persists it the same way as every cash table).
-- This pair is the thin escrow/matchmaking wrapper around it, shaped after
-- cribbage_tables/cribbage_table_players (20260818120000_cribbage_tables.sql
-- -- see that migration's own header for why cribbage needed its own tables
-- rather than pvp_matches, which is 2-player-shaped but not built to carry
-- an engine this different). The same reasoning applies here even more
-- strongly: heads-up poker isn't a discrete-move game at all, it's a whole
-- betting-round engine, which pvp_matches was never built to hold.
--
--   heads_up_tables        -- one row per match: stake, status, which real
--                              game_id it dealt into, who won.
--   heads_up_table_players -- one row per seated player, fixing their seat
--                              (0 or 1) the moment they join.
--
-- Same money-ordering rules as every staked game in this app (see
-- lib/server/heads-up-service.ts, which restates them): a stake leaves a
-- wallet before the seat/table row it pays for exists, a payout is a single
-- credit of the whole pot (both entry fees) to the sole winner, and a
-- leave-before-start refund happens exactly once via a status-guarded write.
--
-- No `state` column, unlike cribbage_tables -- the actual hand-by-hand state
-- is the real poker engine's job and lives in game_state_private under
-- game_id. This table only needs to know status, who's seated, and who won.

create table public.heads_up_tables (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  tier text not null,
  -- Gold PER SEAT, already debited from every seated player at join time.
  -- Always TIER_CONFIG[tier].minBuyIn -- both entrants buy in for exactly
  -- the tier's stack, same reasoning createHeadsUpGame's own comment gives
  -- for why there's no separate buy-in choice here.
  stake integer not null check (stake > 0),
  status text not null default 'waiting'
    check (status in ('waiting', 'active', 'completed', 'cancelled')),
  -- Optimistic concurrency for the transition OUT of 'active' (settling a
  -- win, or cancelling an abandoned match) -- NOT for the poker hands
  -- themselves, which have their own version column on game_state_private.
  -- Dealing (the transition out of 'waiting') is also guarded through this,
  -- same contract as cribbage_tables.version.
  version bigint not null default 1 check (version > 0),
  -- Set only when this table is reserved for one specific invited friend
  -- (lib/server/heads-up-service.ts's openHeadsUpInvite) -- null for an open
  -- quick-play table anyone may match into.
  invitee_id uuid references public.profiles(id),
  -- The real poker table this match dealt into. Null while waiting; set once
  -- and never cleared, the poker engine's own game_id being the durable link
  -- back to every hand actually played.
  game_id uuid references public.games(id),
  winner_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  settled_at timestamptz,
  constraint heads_up_tables_game_matches_status check (
    (status in ('waiting', 'cancelled') and game_id is null)
    or (status in ('active', 'completed') and game_id is not null)
  ),
  constraint heads_up_tables_started_at_matches_status check (
    (status in ('waiting', 'cancelled') and started_at is null)
    or (status in ('active', 'completed') and started_at is not null)
  ),
  constraint heads_up_tables_settled_at_matches_status check (
    (status <> 'completed' and settled_at is null)
    or (status = 'completed' and settled_at is not null)
  ),
  constraint heads_up_tables_winner_matches_status check (
    (status <> 'completed' and winner_id is null)
    or (status = 'completed' and winner_id is not null)
  )
);

comment on table public.heads_up_tables is
  'A heads-up poker match: waiting for an opponent, active (dealt into a real poker game_id), or completed/cancelled.';

comment on column public.heads_up_tables.stake is
  'Gold entry fee per seat, already debited. The pot is stake * 2, credited to winner_id exactly once on completion -- see settle_heads_up_table.';

comment on column public.heads_up_tables.game_id is
  'The real games.id this match dealt into. The actual hands are played through the ordinary poker routes/engine, not through this table.';

-- Quick-play matchmaking: open (non-invite) tables at this tier, oldest
-- first -- see findOpenHeadsUpTable in lib/server/heads-up-store.ts.
create index heads_up_tables_open_idx
  on public.heads_up_tables(tier, created_at asc)
  where status = 'waiting' and invitee_id is null;

-- "What is my own table" -- the waiting-room poll and the invite-accept path.
create index heads_up_tables_host_idx
  on public.heads_up_tables(host_id, created_at desc);

create index heads_up_tables_invitee_idx
  on public.heads_up_tables(invitee_id, created_at desc)
  where invitee_id is not null;

-- Used by the stale-table sweep (refundAbandonedHeadsUp in
-- lib/server/game-store.ts) to find an active heads-up table for a given
-- game_id without a table scan.
create unique index heads_up_tables_game_idx
  on public.heads_up_tables(game_id)
  where game_id is not null;

-- ---------------------------------------------------------------------------
-- One row per seated player. Seat is fixed at join time (0 or 1) and never
-- changes -- it's what createHeadsUpGame's entrants array is built from.
-- ---------------------------------------------------------------------------

create table public.heads_up_table_players (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.heads_up_tables(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  seat smallint not null check (seat = 0 or seat = 1),
  -- The session token this player joined with, captured once at claim time.
  -- The real poker Seat this match deals into (lib/game/engine.ts's
  -- createHeadsUpGame) is owned by a session token, not a profile id -- the
  -- SAME model every other table in this app uses -- and dealing needs BOTH
  -- seated players' real tokens, not just the one on the request that
  -- happens to trigger the deal. Service-role only, same posture as
  -- game_state_private.state, which already holds every seat's ownerToken
  -- at rest; never sent to a client.
  token text not null,
  joined_at timestamptz not null default now(),
  unique (table_id, player_id),
  unique (table_id, seat)
);

comment on table public.heads_up_table_players is
  'One row per seated player, fixing which seat (0 or 1) they deal into. Deleting a row here (leave_heads_up_table) is only legal pre-deal.';

create index heads_up_table_players_table_idx
  on public.heads_up_table_players(table_id);

-- Same accepted gap as cribbage_table_players_player_idx's own comment: "one
-- live table per player" is enforced at the application layer
-- (getActiveHeadsUpTableFor), not by an index that would need to see
-- heads_up_tables.status across tables. A narrow race could double-seat one
-- player at two waiting tables; it cannot lose or duplicate anyone's Gold,
-- since each table's own escrow only ever depends on its own seats.
create index heads_up_table_players_player_idx
  on public.heads_up_table_players(player_id);

-- ---------------------------------------------------------------------------
-- claim_heads_up_seat: atomically assigns the next open seat (0 or 1) to a
-- joining player. Rejects a join to an invite-locked table from anyone but
-- the invitee (or the host, re-reading their own table).
-- ---------------------------------------------------------------------------

create or replace function public.claim_heads_up_seat(
  p_table_id uuid,
  p_player_id uuid,
  p_token text
)
returns table (seat smallint, seated_count integer, host_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_host_id uuid;
  v_invitee_id uuid;
  v_seated_count integer;
  v_seat smallint;
begin
  select t.status, t.host_id, t.invitee_id into v_status, v_host_id, v_invitee_id
  from public.heads_up_tables as t
  where t.id = p_table_id
  for update;

  if v_status is null then
    raise exception 'No such table' using errcode = 'P0002';
  end if;
  if v_status <> 'waiting' then
    raise exception 'That table is no longer taking players' using errcode = 'P0001';
  end if;
  if v_invitee_id is not null and v_invitee_id <> p_player_id and v_host_id <> p_player_id then
    raise exception 'This table is reserved for someone else' using errcode = 'P0001';
  end if;

  select count(*) into v_seated_count
  from public.heads_up_table_players
  where table_id = p_table_id;

  if v_seated_count >= 2 then
    raise exception 'That table is full' using errcode = 'P0001';
  end if;

  select coalesce(min(s), 0) into v_seat
  from generate_series(0, 1) as s
  where not exists (
    select 1 from public.heads_up_table_players
    where table_id = p_table_id and seat = s
  );

  insert into public.heads_up_table_players (table_id, player_id, seat, token)
  values (p_table_id, p_player_id, v_seat, p_token);

  return query select v_seat, v_seated_count + 1, v_host_id;
end;
$$;

revoke all on function public.claim_heads_up_seat(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_heads_up_seat(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- deal_heads_up_table: the ONE transition out of 'waiting', called the
-- instant the 2nd seat is claimed -- there's no host-early-start concept
-- here the way cribbage has at 3-of-4, since a heads-up table only ever
-- needs both of its two seats. p_game_id is the real games.id
-- createHeadsUpGame's caller already persisted via createStoredGame before
-- this runs; this function's job is only the atomic guard (still 'waiting',
-- actually 2 seated) and linking that id in.
-- ---------------------------------------------------------------------------

create or replace function public.deal_heads_up_table(
  p_table_id uuid,
  p_game_id uuid
)
returns public.heads_up_tables
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.heads_up_tables;
  v_seated_count integer;
begin
  select * into v_row
  from public.heads_up_tables
  where id = p_table_id
  for update;

  if v_row.id is null then
    raise exception 'No such table' using errcode = 'P0002';
  end if;
  if v_row.status <> 'waiting' then
    raise exception 'That table has already started' using errcode = 'P0001';
  end if;

  select count(*) into v_seated_count
  from public.heads_up_table_players
  where table_id = p_table_id;

  if v_seated_count <> 2 then
    raise exception 'The table changed -- try again' using errcode = 'P0001';
  end if;

  update public.heads_up_tables
  set status = 'active',
      game_id = p_game_id,
      version = version + 1,
      started_at = now()
  where id = p_table_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.deal_heads_up_table(uuid, uuid) from public, anon, authenticated;
grant execute on function public.deal_heads_up_table(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- cancel_empty_heads_up_table: unwinds a table whose host could not be
-- seated right after creation. Guarded to 'waiting' with genuinely zero
-- seated players, same as cribbage's own version.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_empty_heads_up_table(
  p_table_id uuid,
  p_host_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  delete from public.heads_up_tables
  where id = p_table_id
    and host_id = p_host_id
    and status = 'waiting'
    and not exists (
      select 1 from public.heads_up_table_players where table_id = p_table_id
    )
  returning true;
$$;

revoke all on function public.cancel_empty_heads_up_table(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_empty_heads_up_table(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- leave_heads_up_table: pre-deal only. If the leaver was the host, hands the
-- host role to the remaining seat rather than cancelling their already-
-- staked table; if nobody is left, the table is cancelled.
-- ---------------------------------------------------------------------------

create or replace function public.leave_heads_up_table(
  p_table_id uuid,
  p_player_id uuid
)
returns public.heads_up_table_players
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_host_id uuid;
  v_left public.heads_up_table_players;
  v_new_host uuid;
  v_remaining integer;
begin
  select status, host_id into v_status, v_host_id
  from public.heads_up_tables
  where id = p_table_id
  for update;

  if v_status is null or v_status <> 'waiting' then
    return null;
  end if;

  delete from public.heads_up_table_players
  where table_id = p_table_id and player_id = p_player_id
  returning * into v_left;

  if v_left.id is null then
    return null;
  end if;

  select count(*) into v_remaining
  from public.heads_up_table_players
  where table_id = p_table_id;

  if v_remaining = 0 then
    update public.heads_up_tables set status = 'cancelled' where id = p_table_id;
  elsif v_host_id = p_player_id then
    select player_id into v_new_host
    from public.heads_up_table_players
    where table_id = p_table_id
    order by seat asc
    limit 1;
    update public.heads_up_tables set host_id = v_new_host where id = p_table_id;
  end if;

  return v_left;
end;
$$;

revoke all on function public.leave_heads_up_table(uuid, uuid) from public, anon, authenticated;
grant execute on function public.leave_heads_up_table(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- settle_heads_up_table: the one write that pays a match out. Version-
-- guarded 'active' -> 'completed', so a race between two settlement
-- attempts (the actions route and the advance route can each discover the
-- same finished match) can only credit the winner once -- the loser of that
-- race gets null back and must not pay, same contract as
-- advance_pvp_match/advance_cribbage_table.
-- ---------------------------------------------------------------------------

create or replace function public.settle_heads_up_table(
  p_table_id uuid,
  p_expected_version bigint,
  p_winner_id uuid
)
returns public.heads_up_tables
language sql
security definer
set search_path = public
as $$
  update public.heads_up_tables
  set status = 'completed',
      winner_id = p_winner_id,
      version = version + 1,
      settled_at = now()
  where id = p_table_id
    and version = p_expected_version
    and status = 'active'
  returning *;
$$;

revoke all on function public.settle_heads_up_table(uuid, bigint, uuid) from public, anon, authenticated;
grant execute on function public.settle_heads_up_table(uuid, bigint, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- cancel_stale_heads_up_table: closes an active table BOTH players have
-- abandoned, with no winner -- the caller refunds each seat's original
-- entry fee, never the live poker stack (see lib/server/game-store.ts's
-- refundAbandonedHeadsUp for why crediting the live stack instead would be
-- a real collusion exploit). Version-guarded for the same reason
-- settle_heads_up_table is: this and a genuine settlement racing each other
-- must not both succeed.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_stale_heads_up_table(
  p_table_id uuid,
  p_expected_version bigint
)
returns public.heads_up_tables
language sql
security definer
set search_path = public
as $$
  update public.heads_up_tables
  set status = 'cancelled',
      version = version + 1
  where id = p_table_id
    and version = p_expected_version
    and status = 'active'
  returning *;
$$;

revoke all on function public.cancel_stale_heads_up_table(uuid, bigint) from public, anon, authenticated;
grant execute on function public.cancel_stale_heads_up_table(uuid, bigint) to service_role;

alter table public.heads_up_tables enable row level security;
alter table public.heads_up_table_players enable row level security;
revoke all on public.heads_up_tables from anon, authenticated;
revoke all on public.heads_up_table_players from anon, authenticated;
