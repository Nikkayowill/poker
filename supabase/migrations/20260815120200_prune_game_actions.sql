-- game_actions is written on every fold/check/call/raise/deal/showdown/
-- payout (persist_game_action, try_persist_timed_game_action) -- roughly
-- 15-30 rows per hand, across every live table, and bot-kept tables never
-- stop generating them. Nothing in the app ever reads it back; it was
-- commented as intended for observability/replay/dispute-auditing, but that
-- read side was never built. It is the single highest-write-volume table in
-- the schema with no current payoff, so give it a retention window instead
-- of the "read tool" alternative -- a 30-day trail is enough for any dispute
-- raised while it's still fresh, and the app has no feature that reads
-- further back than that.
--
-- Deletes in bounded batches rather than one statement: the table may already
-- hold weeks of unpruned history by the time this first runs, and a single
-- multi-million-row DELETE would hold a long lock and risk a statement
-- timeout. The cron route calls this repeatedly until a batch comes back
-- short, so a large backlog is worked off over a few runs instead of one.

create index game_actions_created_at_idx on public.game_actions(created_at);

create or replace function public.prune_game_actions(p_older_than_days integer, p_batch_limit integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if p_older_than_days is null or p_older_than_days < 1 then
    raise exception 'Invalid retention window' using errcode = '22023';
  end if;
  if p_batch_limit is null or p_batch_limit < 1 or p_batch_limit > 50000 then
    raise exception 'Invalid batch limit' using errcode = '22023';
  end if;

  with doomed as (
    select id
    from public.game_actions
    where created_at < now() - (p_older_than_days || ' days')::interval
    order by id
    limit p_batch_limit
  )
  delete from public.game_actions
  where id in (select id from doomed);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_game_actions(integer, integer) from public, anon, authenticated;
grant execute on function public.prune_game_actions(integer, integer) to service_role;
