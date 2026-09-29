-- rollover_season() was documented as truncating season_stats on close (see
-- the original comment on that table) but never actually did -- it only
-- copied the top 10 into season_results/profile_badges and left every row
-- behind. season_stats is queried exclusively against the *active* season
-- (getActiveSeason() everywhere in lib/server/stats-store.ts), so a closed
-- season's rows have no reader left; they just accumulate a full
-- player-count of dead rows every 30 days, forever. season_results is
-- already the permanent archive (top 10, kept distinct from season_stats
-- for exactly this reason per its own comment), so it's safe to prune here.

create or replace function public.rollover_season() returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_closing record;
  v_next_start timestamptz;
begin
  select * into v_closing
  from public.seasons
  where status = 'active' and ends_at <= now()
  order by ends_at
  limit 1
  for update;

  if not found then
    return null;
  end if;

  insert into public.season_results (season_id, profile_id, rank, net_profit, badge)
  select
    v_closing.id,
    profile_id,
    row_number() over (order by net_profit desc, profile_id),
    net_profit,
    'season-' || to_char(v_closing.starts_at, 'YYYY-MM') || '-rank-'
      || row_number() over (order by net_profit desc, profile_id)
  from public.season_stats
  where season_id = v_closing.id
  order by net_profit desc
  limit 10;

  insert into public.profile_badges (profile_id, badge, season_id, awarded_at)
  select profile_id, badge, season_id, now()
  from public.season_results
  where season_id = v_closing.id
  on conflict (profile_id, badge) do nothing;

  update public.seasons set status = 'archived' where id = v_closing.id;

  -- The working aggregate is done its job once the top 10 are archived
  -- above; nothing reads a closed season's season_stats after this.
  delete from public.season_stats where season_id = v_closing.id;

  -- The next season starts exactly where this one's window ended rather than
  -- at "now", so a cron that runs late does not shorten every season after
  -- it by however long the check was overdue.
  v_next_start := v_closing.ends_at;
  insert into public.seasons (starts_at, ends_at, status)
  values (v_next_start, v_next_start + interval '30 days', 'active');

  return v_closing.id;
end;
$$;

revoke all on function public.rollover_season() from public, anon, authenticated;
grant execute on function public.rollover_season() to service_role;

comment on function public.rollover_season() is
  'Closes the active season if due, archives its top 10, prunes the closed season''s season_stats rows, and opens the next 30-day season. Call from a scheduled job.';
