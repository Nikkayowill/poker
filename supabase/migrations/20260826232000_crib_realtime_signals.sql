-- Realtime invalidation for cribbage, on the same Broadcast pattern
-- broadcast_game_signal() established for the poker table
-- (game_signal_broadcast.sql) and broadcast_pvp_signal() established for
-- PvP duels (pvp_duel_realtime_signals.sql): a trigger sends a tiny
-- "something changed" ping, and the browser re-fetches its own snapshot
-- rather than trusting anything in the payload.
--
-- Neither cribbage_tables nor cribbage_table_players was ever added to the
-- supabase_realtime publication, so there is no postgres_changes workload to
-- retire here either -- straight to Broadcast, same as the PvP migration.
--
-- Two destinations per event, not one, because cribbage has the same
-- "lobby vs. one live game" split duels do but shaped differently: an open
-- table anyone can join (cribbage-shell.tsx's join screen) vs. a specific
-- table's own live view once seated. `crib:lobby` is a single global channel
-- -- GET /api/cribbage lists open tables across every stake with no
-- per-viewer filter, so there is nothing to key a per-viewer lobby channel
-- on the way duels key theirs per-profile. `crib:<tableId>` is what a seated
-- player's own client actually watches once they have a table id.
--
-- One function serves both tables it fires on, branching on TG_TABLE_NAME
-- the same way broadcast_pvp_signal() does for pvp_challenges/pvp_matches:
--
--   cribbage_tables        -- created, dealt, settled, cancelled. NEW.id (or
--                              OLD.id; a row is never deleted here, but the
--                              coalesce matches the other trigger's shape).
--   cribbage_table_players  -- joined or left (leaveCribbageTable is
--                              pre-deal only). claim_cribbage_seat() ONLY
--                              writes this table -- it never touches
--                              cribbage_tables -- so a trigger on
--                              cribbage_tables alone would miss every join,
--                              and the open list's seatedCount would never
--                              update.
--
-- No version in the payload, same reasoning as the PvP migration: a table
-- row and a seat row don't share one monotonic counter, cribbage-shell.tsx's
-- refresh() always re-reads the whole lobby-or-table snapshot anyway, and
-- the event firing is the signal, not anything inside it.
create or replace function public.broadcast_crib_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table_id uuid;
begin
  -- NEW is an unassigned record (not merely null) on a DELETE row trigger,
  -- and OLD likewise on INSERT -- referencing the wrong one raises "record
  -- is not assigned yet" rather than reading as null, so this branches on
  -- tg_op instead of trying to coalesce across both.
  if tg_table_name = 'cribbage_tables' then
    -- Only ever fires for insert/update (see the trigger below), so NEW is
    -- always assigned here.
    v_table_id := new.id;
  elsif tg_table_name = 'cribbage_table_players' then
    if tg_op = 'DELETE' then
      v_table_id := old.table_id;
    else
      v_table_id := new.table_id;
    end if;
  else
    return null;
  end if;

  perform realtime.send(
    jsonb_build_object('v', 1),
    'CRIB_STATE_CHANGED',
    'crib:lobby',
    false
  );

  perform realtime.send(
    jsonb_build_object('v', 1),
    'CRIB_STATE_CHANGED',
    'crib:' || v_table_id::text,
    false
  );

  return null;
end;
$$;

drop trigger if exists broadcast_crib_signal_after_table_write
  on public.cribbage_tables;

create trigger broadcast_crib_signal_after_table_write
after insert or update on public.cribbage_tables
for each row execute function public.broadcast_crib_signal();

drop trigger if exists broadcast_crib_signal_after_seat_write
  on public.cribbage_table_players;

create trigger broadcast_crib_signal_after_seat_write
after insert or delete on public.cribbage_table_players
for each row execute function public.broadcast_crib_signal();

-- Same hardening every trigger function here gets (see
-- 20260813170000_revoke_pvp_trigger_function_execute.sql): Postgres invokes a
-- trigger function directly regardless of the firing role's EXECUTE grant, so
-- revoking it only closes the accidental /rest/v1/rpc/broadcast_crib_signal
-- call path, which would error on NEW/OLD being unassigned anyway but
-- shouldn't be reachable at all.
revoke execute on function public.broadcast_crib_signal() from public, anon, authenticated;
