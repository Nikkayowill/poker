-- Tighten the runaway-connection guard from 20260819173729_runaway_connection_guard.sql.
-- Kayo doesn't want stale connections lingering even briefly on the free tier. A real
-- call to these RPCs finishes in well under a second (single Vercel request, game-store.ts),
-- so 3 minutes of continuous activity is already generous room for the kill threshold, and
-- a 1-minute sweep catches it fast instead of waiting up to 5.

create or replace function public.terminate_runaway_game_backends()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_killed integer := 0;
  v_row record;
begin
  for v_row in
    select pid, backend_start, query
    from pg_catalog.pg_stat_activity
    where datname = current_database()
      and application_name = 'PostgREST 14.5'
      and state = 'active'
      and backend_start < now() - interval '3 minutes'
      and (query ilike '%persist_game_action%' or query ilike '%try_persist_timed_game_action%')
  loop
    perform pg_catalog.pg_terminate_backend(v_row.pid);
    insert into public.runaway_connection_kills (pid, backend_start, query_snippet)
    values (v_row.pid, v_row.backend_start, left(v_row.query, 500));
    v_killed := v_killed + 1;
  end loop;
  return v_killed;
end;
$$;

select cron.schedule(
  'kill-runaway-game-backends',
  '* * * * *',
  $$select public.terminate_runaway_game_backends();$$
);
