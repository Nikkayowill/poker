-- Realtime Broadcast scales independently of the number of Postgres Changes
-- subscribers and does not keep polling the WAL for an otherwise idle game.
-- The payload is only an invalidation version; private cards remain in the
-- service-role-only game_state_private table.

create or replace function public.broadcast_game_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('version', new.version),
    'TABLE_STATE_CHANGED',
    'table:' || new.game_id::text,
    false
  );
  return null;
end;
$$;

drop trigger if exists broadcast_game_signal_after_write
  on public.game_signals;

create trigger broadcast_game_signal_after_write
after insert or update on public.game_signals
for each row execute function public.broadcast_game_signal();

-- This table was previously consumed through postgres_changes. Once the
-- trigger is installed, remove it from logical replication so an empty
-- platform does not retain a WAL polling workload for game notifications.
do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'game_signals'
  ) then
    execute 'alter publication supabase_realtime drop table public.game_signals';
  end if;
end;
$$;

revoke all on function public.broadcast_game_signal() from public, anon, authenticated;
