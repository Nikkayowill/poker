-- Two fixes for the heads-up and Sit & Go escrow tables.
--
-- 1. Each seat row now remembers the gold_ledger correlation id of the stake
--    that paid for it. Leave refunds and deal-failure refunds credit against
--    that same id, so the reconcile-stale-stakes cron and the app can never
--    both refund one stake, and the deal re-confirms every seat's debit so
--    the cron never refunds a player who is actually playing.
--
-- 2. deal_heads_up_table gets an overload that checks the exact players (and
--    their session tokens, by seat) the service built the game from. The old
--    count-only guard let a leave plus a rejoin between the service's seat
--    read and the deal put a refunded player into the game and leave a
--    paying one out.
--
-- The old claim/deal signatures are left in place so code deployed before
-- this migration keeps working until the new code ships.

alter table public.heads_up_table_players
  add column stake_correlation_id text;

alter table public.sit_and_go_table_players
  add column stake_correlation_id text;

comment on column public.heads_up_table_players.stake_correlation_id is
  'gold_ledger correlation id of the stake debit that paid for this seat. Refunds credit against it. Null only for seats claimed before this column existed.';

comment on column public.sit_and_go_table_players.stake_correlation_id is
  'gold_ledger correlation id of the entry fee debit that paid for this seat. Refunds credit against it. Null only for seats claimed before this column existed.';


create or replace function public.claim_heads_up_seat(
  p_table_id uuid,
  p_player_id uuid,
  p_token text,
  p_stake_correlation_id text
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
  from public.heads_up_table_players as hup
  where hup.table_id = p_table_id;

  if v_seated_count >= 2 then
    raise exception 'That table is full' using errcode = 'P0001';
  end if;

  select coalesce(min(s), 0) into v_seat
  from generate_series(0, 1) as s
  where not exists (
    select 1 from public.heads_up_table_players as hup
    where hup.table_id = p_table_id and hup.seat = s
  );

  insert into public.heads_up_table_players (table_id, player_id, seat, token, stake_correlation_id)
  values (p_table_id, p_player_id, v_seat, p_token, p_stake_correlation_id);

  return query select v_seat, v_seated_count + 1, v_host_id;
end;
$$;

revoke all on function public.claim_heads_up_seat(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_heads_up_seat(uuid, uuid, text, text) to service_role;


create or replace function public.claim_sit_and_go_seat(
  p_table_id uuid,
  p_player_id uuid,
  p_token uuid,
  p_stake_correlation_id text
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
  from public.sit_and_go_table_players as sgtp
  where sgtp.table_id = p_table_id;

  if v_seated_count >= 6 then
    raise exception 'That table is full' using errcode = 'P0001';
  end if;

  select coalesce(min(s), 0) into v_seat
  from generate_series(0, 5) as s
  where not exists (
    select 1 from public.sit_and_go_table_players as sgtp
    where sgtp.table_id = p_table_id and sgtp.seat = s
  );

  insert into public.sit_and_go_table_players (table_id, player_id, seat, token, stake_correlation_id)
  values (p_table_id, p_player_id, v_seat, p_token, p_stake_correlation_id);

  return query select v_seat, v_seated_count + 1, v_host_id;
end;
$$;

revoke all on function public.claim_sit_and_go_seat(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_sit_and_go_seat(uuid, uuid, uuid, text) to service_role;


-- Deals only if the seated players and their tokens, in seat order, are
-- exactly the ones the caller built p_game_id from. Anything else raises
-- P0001 so the service retires that game and tries again with fresh seats.
create or replace function public.deal_heads_up_table(
  p_table_id uuid,
  p_game_id uuid,
  p_player_ids uuid[],
  p_tokens text[]
)
returns public.heads_up_tables
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.heads_up_tables;
  v_player_ids uuid[];
  v_tokens text[];
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

  select array_agg(hup.player_id order by hup.seat), array_agg(hup.token order by hup.seat)
  into v_player_ids, v_tokens
  from public.heads_up_table_players as hup
  where hup.table_id = p_table_id;

  if coalesce(array_length(v_player_ids, 1), 0) <> 2
     or v_player_ids is distinct from p_player_ids
     or v_tokens is distinct from p_tokens then
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

revoke all on function public.deal_heads_up_table(uuid, uuid, uuid[], text[]) from public, anon, authenticated;
grant execute on function public.deal_heads_up_table(uuid, uuid, uuid[], text[]) to service_role;


-- Feeds the sweep that unwinds a Sit & Go stuck 'active' with no game.
create index sit_and_go_tables_undealt_idx
  on public.sit_and_go_tables(started_at)
  where status = 'active' and game_id is null;
