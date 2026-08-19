-- Incident (2026-08-19): two service_role PostgREST connections (opened
-- 2026-08-11 and 2026-08-16) were found still alive and actively looping
-- persist_game_action with zero backoff, sustaining 40-80k "Concurrent game
-- update" (40001) errors per minute for days. Neither connection ever went
-- through Vercel -- CPU there stayed near zero the whole time -- so this was
-- a stray client holding service_role credentials directly against
-- PostgREST, not a bug in the app's own request handlers (each of which
-- makes exactly one RPC attempt per HTTP request; nothing in
-- app/api/games retries in a tight loop). Manually killed via
-- pg_terminate_backend once noticed. This migration is the backstop so a
-- recurrence -- whatever process causes it -- gets cut off in minutes
-- instead of running for over a week unnoticed.
--
-- Two independent layers:
--
-- 1. statement_timeout on the API roles. Does not stop a fast tight loop of
--    quick successful round-trips (those aren't "stuck"), but caps any
--    single query that genuinely hangs -- defense in depth, not the fix for
--    the actual incident.
alter role anon set statement_timeout = '20s';
alter role authenticated set statement_timeout = '20s';
alter role service_role set statement_timeout = '20s';

-- 2. A pg_cron sweep, since the incident wasn't a hung query -- it was
--    thousands of fast, successful-at-the-network-layer round trips in a
--    row with no delay. No legitimate caller of persist_game_action /
--    try_persist_timed_game_action ever holds one PostgREST connection
--    continuously "active" against those functions: every real call
--    originates from a single Vercel request (game-store.ts), completes in
--    well under a second, and the connection goes idle between hands. A
--    connection still mid-query against these functions and older than 15
--    minutes is not real traffic under this app's own request shape.
create extension if not exists pg_cron;

create table if not exists public.runaway_connection_kills (
  id bigint generated always as identity primary key,
  pid integer not null,
  backend_start timestamptz not null,
  query_snippet text not null,
  killed_at timestamptz not null default now()
);
comment on table public.runaway_connection_kills is
  'Audit log for terminate_runaway_game_backends(); see 20260819173024_runaway_connection_guard.sql. Empty is the healthy state -- any row here means the pg_cron sweep actually fired and is worth investigating, not routine.';

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
      and backend_start < now() - interval '15 minutes'
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
comment on function public.terminate_runaway_game_backends() is
  'pg_cron backstop for the 2026-08-19 runaway-connection incident. Kills any PostgREST connection still mid-query against persist_game_action/try_persist_timed_game_action after 15 minutes -- no legitimate caller (see game-store.ts) ever holds a connection that shape. Logs every kill to runaway_connection_kills.';

-- Owned by no one but the scheduler itself; nothing else needs to call it.
revoke all on function public.terminate_runaway_game_backends() from public, anon, authenticated, service_role;

select cron.schedule(
  'kill-runaway-game-backends',
  '*/5 * * * *',
  $$select public.terminate_runaway_game_backends();$$
);
