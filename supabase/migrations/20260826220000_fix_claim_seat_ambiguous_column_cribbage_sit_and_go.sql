-- Same bug as 20260826180000's claim_heads_up_seat fix, found in the other
-- two seat-claiming functions shaped after the same pattern: a
-- RETURNS TABLE(seat smallint, ...) out parameter puts an implicit `seat`
-- variable in scope for the whole function body, which collides with the
-- unqualified `seat` column reference inside the "next open seat" subquery.
-- Confirmed live against production (rollback-safe repro, no rows written):
-- every claim_sit_and_go_seat call throws "column reference \"seat\" is
-- ambiguous", and so does claim_cribbage_seat -- meaning cribbage seat
-- joining has been broken in production since it shipped. Fixed the same
-- way: alias the table and qualify the column.

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

  select coalesce(min(s), 0) into v_seat
  from generate_series(0, 3) as s
  where not exists (
    select 1 from public.cribbage_table_players as ctp
    where ctp.table_id = p_table_id and ctp.seat = s
  );

  insert into public.cribbage_table_players (table_id, player_id, seat)
  values (p_table_id, p_player_id, v_seat);

  return query select v_seat, v_seated_count + 1, v_host_id;
end;
$$;

revoke all on function public.claim_cribbage_seat(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_cribbage_seat(uuid, uuid) to service_role;

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

  select coalesce(min(s), 0) into v_seat
  from generate_series(0, 5) as s
  where not exists (
    select 1 from public.sit_and_go_table_players as sgtp
    where sgtp.table_id = p_table_id and sgtp.seat = s
  );

  insert into public.sit_and_go_table_players (table_id, player_id, seat, token)
  values (p_table_id, p_player_id, v_seat, p_token);

  return query select v_seat, v_seated_count + 1, v_host_id;
end;
$$;

revoke all on function public.claim_sit_and_go_seat(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_sit_and_go_seat(uuid, uuid, uuid) to service_role;
