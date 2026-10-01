-- Realtime pings for the Sit & Go and Heads-Up waiting rooms, on the same
-- Broadcast pattern as broadcast_crib_signal() and broadcast_pvp_signal().
-- A trigger sends a tiny "something changed" ping and the browser re-reads
-- its own snapshot, so nothing in the payload is trusted. This replaces the
-- 2 second poll both waiting rooms ran.
--
-- Neither pair of tables is in the supabase_realtime publication, so there
-- is no postgres_changes workload to retire.
--
-- Sit & Go mirrors cribbage: `sng:lobby` for the open-table list everyone
-- sees, and `sng:<tableId>` once seated. claim_sit_and_go_seat() only writes
-- sit_and_go_table_players, so that table needs its own trigger or a join
-- would never reach the open list.
--
-- Heads-Up has no browsable list, but an invitee has no table id to watch
-- until the invite arrives, so its channel is per profile (`hu:<profileId>`)
-- like duels. Each write pings the host, the invitee and every seated player.

create or replace function public.broadcast_sit_and_go_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table_id uuid;
begin
  if tg_table_name = 'sit_and_go_tables' then
    v_table_id := new.id;
  elsif tg_table_name = 'sit_and_go_table_players' then
    if tg_op = 'DELETE' then
      v_table_id := old.table_id;
    else
      v_table_id := new.table_id;
    end if;
  else
    return null;
  end if;

  perform realtime.send(jsonb_build_object('v', 1), 'SNG_STATE_CHANGED', 'sng:lobby', false);
  perform realtime.send(jsonb_build_object('v', 1), 'SNG_STATE_CHANGED', 'sng:' || v_table_id::text, false);

  return null;
end;
$$;

drop trigger if exists broadcast_sit_and_go_signal_after_table_write
  on public.sit_and_go_tables;

create trigger broadcast_sit_and_go_signal_after_table_write
after insert or update on public.sit_and_go_tables
for each row execute function public.broadcast_sit_and_go_signal();

drop trigger if exists broadcast_sit_and_go_signal_after_seat_write
  on public.sit_and_go_table_players;

create trigger broadcast_sit_and_go_signal_after_seat_write
after insert or delete on public.sit_and_go_table_players
for each row execute function public.broadcast_sit_and_go_signal();

create or replace function public.broadcast_heads_up_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_table_id uuid;
  v_actor uuid;
begin
  if tg_table_name = 'heads_up_tables' then
    select coalesce(array_agg(distinct s.x), '{}')
      into v_ids
      from (
        select new.host_id as x
        union select new.invitee_id
        union select p.player_id from public.heads_up_table_players p where p.table_id = new.id
      ) s
      where s.x is not null;
  elsif tg_table_name = 'heads_up_table_players' then
    if tg_op = 'DELETE' then
      v_table_id := old.table_id;
      v_actor := old.player_id;
    else
      v_table_id := new.table_id;
      v_actor := new.player_id;
    end if;
    -- The table row can already be gone when a delete cascades from it, in
    -- which case only the acting player is left to ping.
    select coalesce(array_agg(distinct s.x), '{}')
      into v_ids
      from (
        select v_actor as x
        union select t.host_id from public.heads_up_tables t where t.id = v_table_id
        union select t.invitee_id from public.heads_up_tables t where t.id = v_table_id
      ) s
      where s.x is not null;
  else
    return null;
  end if;

  foreach v_id in array v_ids loop
    perform realtime.send(jsonb_build_object('v', 1), 'HEADS_UP_STATE_CHANGED', 'hu:' || v_id::text, false);
  end loop;

  return null;
end;
$$;

drop trigger if exists broadcast_heads_up_signal_after_table_write
  on public.heads_up_tables;

create trigger broadcast_heads_up_signal_after_table_write
after insert or update on public.heads_up_tables
for each row execute function public.broadcast_heads_up_signal();

drop trigger if exists broadcast_heads_up_signal_after_seat_write
  on public.heads_up_table_players;

create trigger broadcast_heads_up_signal_after_seat_write
after insert or delete on public.heads_up_table_players
for each row execute function public.broadcast_heads_up_signal();

-- Trigger functions only, never meant to be called over /rest/v1/rpc.
revoke execute on function public.broadcast_sit_and_go_signal() from public, anon, authenticated;
revoke execute on function public.broadcast_heads_up_signal() from public, anon, authenticated;
