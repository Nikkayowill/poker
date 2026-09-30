-- Rank from solo earnings.
--
-- Rank used to be Gold staked, so it climbed just by playing. It is now the
-- difficulty-weighted net of every settled solo wager (see
-- lib/progression/solo-earnings.ts). This migration adds the counters that rank
-- and the earnings tracker read.
--
-- Two tables and two functions:
--
--  * solo_earning_events: one row per settled solo wager, keyed by a
--    correlation id the service builds from the attempt. The primary key is what
--    makes recording idempotent: a retried settle inserts nothing and counts
--    nothing.
--  * solo_earnings_by_band: running totals per profile and stake band. Rank and
--    the difficulty gauge are derived from these in code, with the band weights
--    in lib/progression/solo-earnings.ts, so retuning a weight never needs a
--    data migration.
--  * record_solo_result: inserts the event and bumps the band totals in one
--    statement, only when the event is new.
--  * claim_rank_milestones: moves the "highest level already rewarded" mark up
--    and returns where it was. Rank can now fall as well as rise, so without this
--    a player could drop a level and climb it again to be paid the same milestone
--    twice. The mark only ever moves up.
--
-- Existing players are carried over, not reset: rank_base_points is the points at
-- the start of the level their old XP put them on, and max_level_rewarded is that
-- level, so nothing they were already paid is paid again.
--
-- Same access posture as player_progression: service role only.

alter table public.player_progression
  add column rank_base_points bigint not null default 0 check (rank_base_points >= 0),
  add column max_level_rewarded integer not null default 1 check (max_level_rewarded >= 1);

comment on column public.player_progression.rank_base_points is
  'Rank points a player started the solo-earnings rank with, carried over from the old wager-volume level. Rank points = this + weighted net solo earnings, floored at 0.';
comment on column public.player_progression.max_level_rewarded is
  'The highest level whose milestone Gold has been paid. Only ever moves up, so a rank that falls and climbs back pays nothing twice.';

-- Carry over: the level the old XP curve (250 per step, triangular, max 100)
-- puts each existing player on, and the points at the start of that level.
with levelled as (
  select
    profile_id,
    least(100, floor((1 + sqrt(1 + 8.0 * xp / 250)) / 2))::integer as estimate,
    xp
  from public.player_progression
),
corrected as (
  select
    profile_id,
    case
      when estimate > 1 and 250 * (estimate - 1) * estimate / 2 > xp then estimate - 1
      else estimate
    end as level
  from levelled
)
update public.player_progression as pp
set rank_base_points = 250 * (corrected.level - 1) * corrected.level / 2,
    max_level_rewarded = greatest(1, corrected.level)
from corrected
where pp.profile_id = corrected.profile_id;

create table public.solo_earning_events (
  correlation_id text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  game text not null,
  band smallint not null check (band >= 0),
  wager bigint not null check (wager > 0),
  payout bigint not null check (payout >= 0),
  created_at timestamptz not null default now()
);

comment on table public.solo_earning_events is
  'One row per settled solo wager. The correlation id is the idempotency key for recording it.';

create index solo_earning_events_profile_idx
  on public.solo_earning_events (profile_id, created_at desc);

create table public.solo_earnings_by_band (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  band smallint not null check (band >= 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  staked bigint not null default 0 check (staked >= 0),
  paid_out bigint not null default 0 check (paid_out >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, band)
);

comment on table public.solo_earnings_by_band is
  'Running solo-wager totals per profile and stake band. Rank points and the difficulty gauge are derived from these in lib/progression/solo-earnings.ts.';

-- ---------------------------------------------------------------------------
-- Recording a settled wager.
--
-- Returns whether the event was new. The band totals move only when it was, in
-- the same function, so a retry of the same settle cannot count twice.
-- ---------------------------------------------------------------------------

create or replace function public.record_solo_result(
  p_profile_id uuid,
  p_correlation_id text,
  p_game text,
  p_band smallint,
  p_wager bigint,
  p_payout bigint
)
returns table (recorded boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_wager is null or p_wager <= 0 or p_payout is null or p_payout < 0
     or p_band is null or p_band < 0 or p_correlation_id is null or p_game is null then
    raise exception 'Invalid solo result' using errcode = '22023';
  end if;

  insert into public.solo_earning_events (correlation_id, profile_id, game, band, wager, payout)
  values (p_correlation_id, p_profile_id, p_game, p_band, p_wager, p_payout)
  on conflict (correlation_id) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return query select false;
    return;
  end if;

  insert into public.solo_earnings_by_band as b (profile_id, band, wins, losses, staked, paid_out)
  values (
    p_profile_id,
    p_band,
    case when p_payout > 0 then 1 else 0 end,
    case when p_payout > 0 then 0 else 1 end,
    p_wager,
    p_payout
  )
  on conflict (profile_id, band) do update
  set wins = b.wins + excluded.wins,
      losses = b.losses + excluded.losses,
      staked = b.staked + excluded.staked,
      paid_out = b.paid_out + excluded.paid_out,
      updated_at = now();

  return query select true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Claiming milestone levels.
--
-- Advances the "highest level rewarded" mark to p_level if that is higher, and
-- returns where it stood before. The caller pays the milestones in
-- (previous_level, p_level]. Locked read-modify-write, so two settles landing
-- together cannot both see the same previous level and both pay.
-- ---------------------------------------------------------------------------

create or replace function public.claim_rank_milestones(
  p_profile_id uuid,
  p_level integer
)
returns table (previous_level integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous integer;
begin
  if p_level is null or p_level < 1 then
    raise exception 'Invalid level' using errcode = '22023';
  end if;

  insert into public.player_progression (profile_id)
  values (p_profile_id)
  on conflict (profile_id) do nothing;

  select pp.max_level_rewarded into v_previous
  from public.player_progression as pp
  where pp.profile_id = p_profile_id
  for update;

  if p_level > v_previous then
    update public.player_progression
    set max_level_rewarded = p_level,
        updated_at = now()
    where profile_id = p_profile_id;
  end if;

  return query select v_previous;
end;
$$;

revoke all on function public.record_solo_result(uuid, text, text, smallint, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.record_solo_result(uuid, text, text, smallint, bigint, bigint)
  to service_role;
revoke all on function public.claim_rank_milestones(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_rank_milestones(uuid, integer)
  to service_role;

alter table public.solo_earning_events enable row level security;
alter table public.solo_earnings_by_band enable row level security;
revoke all on public.solo_earning_events from anon, authenticated;
revoke all on public.solo_earnings_by_band from anon, authenticated;
