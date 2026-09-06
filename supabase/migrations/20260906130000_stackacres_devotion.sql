-- The Pixel Pilgrim's devotion: a per-player UTC-day prayer streak, and
-- which ladder rungs (exclusive relic grants) have been claimed.
--
-- A fresh table, not a reuse of homestead_secret_ledger: that ledger is a
-- free-form item-id/quantity counter and has no room for "which UTC day was
-- the last prayer" or "which rungs of a fixed ladder are claimed" without
-- overloading its shape. lib/stackacres/devotion.ts's pure applyPrayer is
-- the single source of truth for the rollover rule (same UTC day -> no-op,
-- the very next UTC day -> streak + 1, any gap -> reset to 1, at most one
-- newly-earned rung claimed per prayer); this migration's RPC is a SQL
-- restatement of that exact function, kept in step by hand.
--
-- NAME CHECKED AGAINST THE LIVE SCHEMA, not just this repo's migrations:
-- confirmed via information_schema that homestead_devotion and
-- pray_at_homestead_shrine are both free.
--
-- CHECK, not a BEFORE INSERT trigger, on streak >= 0: unlike a spend, streak
-- only ever moves to a literal 1 or to (stored value + 1), never through a
-- transient negative, so there is no in-flight row a CHECK could strand --
-- same reasoning homestead_secret_ledger's own quantity >= 0 check gives.

create table public.homestead_devotion (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  streak integer not null default 0 check (streak >= 0),
  last_prayed_day date,
  claimed_rungs integer[] not null default '{}',
  updated_at timestamptz not null default now()
);

comment on table public.homestead_devotion is
  'The Pixel Pilgrim''s devotion: per-player UTC-day prayer streak and claimed ladder rungs (relic grants). Service-role only.';

alter table public.homestead_devotion enable row level security;
revoke all on public.homestead_devotion from anon, authenticated;

-- Row-locking upsert, never a read-then-write: two tabs praying at the same
-- moment must not both see the pre-advance streak and both claim the same
-- rung. p_rung_thresholds is DEVOTION_RUNG_THRESHOLDS, service-owned data
-- this function has no other way to know, same pattern a secret zone's roll
-- is handed its own odds rather than knowing them itself.
create or replace function public.pray_at_homestead_shrine(
  p_profile_id uuid,
  p_today date,
  p_yesterday date,
  p_rung_thresholds integer[]
)
returns table (streak integer, already_prayed_today boolean, granted_rung integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  cur_streak integer;
  cur_last_prayed_day date;
  cur_claimed_rungs integer[];
  new_streak integer;
  claimed integer[];
  i integer;
  rung_count integer;
  g integer := null;
begin
  select d.streak, d.last_prayed_day, d.claimed_rungs
    into cur_streak, cur_last_prayed_day, cur_claimed_rungs
  from public.homestead_devotion d
  where d.profile_id = p_profile_id
  for update;

  if cur_last_prayed_day = p_today then
    return query select coalesce(cur_streak, 0), true, null::integer;
    return;
  end if;

  if cur_last_prayed_day = p_yesterday then
    new_streak := coalesce(cur_streak, 0) + 1;
  else
    new_streak := 1;
  end if;
  claimed := coalesce(cur_claimed_rungs, '{}');

  -- The first unclaimed rung whose threshold the new streak now meets, if
  -- any -- rung index is 0-based (array position - 1), matching
  -- DEVOTION_LADDER's own indexing in lib/stackacres/devotion.ts.
  rung_count := coalesce(array_length(p_rung_thresholds, 1), 0);
  for i in 1 .. rung_count loop
    if new_streak >= p_rung_thresholds[i] and not ((i - 1) = any(claimed)) then
      g := i - 1;
      claimed := array_append(claimed, g);
      exit;
    end if;
  end loop;

  insert into public.homestead_devotion as d (profile_id, streak, last_prayed_day, claimed_rungs, updated_at)
  values (p_profile_id, new_streak, p_today, claimed, now())
  on conflict (profile_id) do update
    set streak = excluded.streak,
        last_prayed_day = excluded.last_prayed_day,
        claimed_rungs = excluded.claimed_rungs,
        updated_at = now();

  return query select new_streak, false, g;
end;
$$;

comment on function public.pray_at_homestead_shrine(uuid, date, date, integer[]) is
  'Advances the caller''s devotion streak for one UTC day (idempotent within a day) and claims at most one newly-earned ladder rung.';

-- `public` is load-bearing here, not redundant with anon/authenticated: see
-- reference_stackchips_revoke_execute_from_public -- omitting it has shipped
-- a SECURITY DEFINER function anonymously callable on /rest/v1/rpc twice
-- already. Verify with proacl after applying, not by re-reading this file.
revoke all on function public.pray_at_homestead_shrine(uuid, date, date, integer[]) from public, anon, authenticated;
