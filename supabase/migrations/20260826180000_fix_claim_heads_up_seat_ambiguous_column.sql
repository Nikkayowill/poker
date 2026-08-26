-- ---------------------------------------------------------------------------
-- Fix claim_heads_up_seat: the RETURNS TABLE(seat smallint, ...) out
-- parameter introduces an implicit `seat` variable in scope for the whole
-- function body, which collided with the `seat` column reference inside the
-- "next open seat" subquery -- every join attempt failed with "column
-- reference \"seat\" is ambiguous". Fixed by aliasing the table and
-- qualifying the column.
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
    select 1 from public.heads_up_table_players as hup
    where hup.table_id = p_table_id and hup.seat = s
  );

  insert into public.heads_up_table_players (table_id, player_id, seat, token)
  values (p_table_id, p_player_id, v_seat, p_token);

  return query select v_seat, v_seated_count + 1, v_host_id;
end;
$$;

revoke all on function public.claim_heads_up_seat(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_heads_up_seat(uuid, uuid, text) to service_role;
