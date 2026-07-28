-- Leaderboards, seasons and per-player stats.
--
-- Source of truth is an append-only event log (hand_results), not the
-- aggregates. A cumulative counter updated in place has no way to tell a
-- retried write from a new one -- and the turn-flow fixes in this same
-- release exist precisely because retries happen (a duplicate /advance, two
-- lambdas racing the same expired deadline). The unique key on
-- (game_id, hand_number, profile_id) makes recording a hand's result safe to
-- call more than once: the second call finds its row already there and
-- touches nothing.
--
-- player_stats and season_stats are aggregates derived from that log, kept
-- as running totals (rather than summed on every read) because a leaderboard
-- read has to be cheap -- it is the one query real users hit constantly, and
-- a table of a few thousand rows read with an index on net_profit is a
-- fraction of a millisecond next to summing an ever-growing event log.

create table if not exists public.hand_results (
  id bigint generated always as identity primary key,
  game_id uuid not null,
  hand_number integer not null check (hand_number > 0),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  won boolean not null,
  amount_won integer not null default 0 check (amount_won >= 0),
  net_profit integer not null,
  vpip boolean not null,
  played_at timestamptz not null default now(),
  unique (game_id, hand_number, profile_id)
);

create index if not exists hand_results_profile_idx on public.hand_results (profile_id, played_at desc);

alter table public.hand_results enable row level security;
revoke all on table public.hand_results from public, anon, authenticated;

create table if not exists public.player_stats (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  hands_played integer not null default 0,
  hands_won integer not null default 0,
  vpip_hands integer not null default 0,
  net_profit bigint not null default 0,
  biggest_pot_won integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists player_stats_net_profit_idx on public.player_stats (net_profit desc);

alter table public.player_stats enable row level security;
revoke all on table public.player_stats from public, anon, authenticated;
-- Stats are public by nature -- that is what a leaderboard is -- so unlike
-- every Gold-bearing table here, anon/authenticated get a read grant. What
-- they cannot do is decide what the numbers say: every write stays
-- service-role only, through record_hand_result.
grant select on table public.player_stats to anon, authenticated;

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now()
);

-- Only one season may be active at a time -- a partial unique index rather
-- than a boolean flag, so the database itself refuses a second one instead
-- of relying on every caller to check first.
create unique index if not exists seasons_one_active_idx on public.seasons (status) where status = 'active';

alter table public.seasons enable row level security;
revoke all on table public.seasons from public, anon, authenticated;
grant select on table public.seasons to anon, authenticated;

create table if not exists public.season_stats (
  season_id uuid not null references public.seasons(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  hands_played integer not null default 0,
  hands_won integer not null default 0,
  net_profit bigint not null default 0,
  biggest_pot_won integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (season_id, profile_id)
);

create index if not exists season_stats_rank_idx on public.season_stats (season_id, net_profit desc);

alter table public.season_stats enable row level security;
revoke all on table public.season_stats from public, anon, authenticated;
grant select on table public.season_stats to anon, authenticated;

-- Archive of finished seasons: who placed, and the flair they earned for it.
-- Kept distinct from season_stats (which is live and gets truncated by
-- rollover_season) so a champion's record outlives the season it was won in.
create table if not exists public.season_results (
  season_id uuid not null references public.seasons(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  rank integer not null check (rank > 0),
  net_profit bigint not null,
  badge text not null,
  created_at timestamptz not null default now(),
  primary key (season_id, profile_id)
);

alter table public.season_results enable row level security;
revoke all on table public.season_results from public, anon, authenticated;
grant select on table public.season_results to anon, authenticated;

-- The flair a season win leaves behind, surfaced on a profile alongside its
-- bought cosmetics. Separate from season_results (which is the full
-- standings archive) because a profile page wants "what badges do they have"
-- without joining every season they ever played in.
create table if not exists public.profile_badges (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  badge text not null,
  season_id uuid references public.seasons(id) on delete set null,
  awarded_at timestamptz not null default now(),
  primary key (profile_id, badge)
);

alter table public.profile_badges enable row level security;
revoke all on table public.profile_badges from public, anon, authenticated;
grant select on table public.profile_badges to anon, authenticated;

-- Records one seat's result for one hand, and folds it into both the
-- lifetime and current-season aggregates. Idempotent: a repeat call for a
-- (game_id, hand_number, profile_id) already on file changes nothing and
-- returns false, rather than the aggregates counting that hand twice.
create or replace function public.record_hand_result(
  p_game_id uuid,
  p_hand_number integer,
  p_profile_id uuid,
  p_won boolean,
  p_amount_won integer,
  p_net_profit integer,
  p_vpip boolean
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_active_season uuid;
begin
  insert into public.hand_results (
    game_id, hand_number, profile_id, won, amount_won, net_profit, vpip
  ) values (
    p_game_id, p_hand_number, p_profile_id, p_won, p_amount_won, p_net_profit, p_vpip
  )
  on conflict (game_id, hand_number, profile_id) do nothing;

  if not found then
    return false;
  end if;

  insert into public.player_stats (
    profile_id, hands_played, hands_won, vpip_hands, net_profit, biggest_pot_won, updated_at
  ) values (
    p_profile_id, 1, case when p_won then 1 else 0 end, case when p_vpip then 1 else 0 end,
    p_net_profit, p_amount_won, now()
  )
  on conflict (profile_id) do update set
    hands_played = public.player_stats.hands_played + 1,
    hands_won = public.player_stats.hands_won + case when p_won then 1 else 0 end,
    vpip_hands = public.player_stats.vpip_hands + case when p_vpip then 1 else 0 end,
    net_profit = public.player_stats.net_profit + p_net_profit,
    biggest_pot_won = greatest(public.player_stats.biggest_pot_won, p_amount_won),
    updated_at = now();

  select id into v_active_season
  from public.seasons
  where status = 'active' and now() between starts_at and ends_at
  limit 1;

  if v_active_season is not null then
    insert into public.season_stats (
      season_id, profile_id, hands_played, hands_won, net_profit, biggest_pot_won, updated_at
    ) values (
      v_active_season, p_profile_id, 1, case when p_won then 1 else 0 end,
      p_net_profit, p_amount_won, now()
    )
    on conflict (season_id, profile_id) do update set
      hands_played = public.season_stats.hands_played + 1,
      hands_won = public.season_stats.hands_won + case when p_won then 1 else 0 end,
      net_profit = public.season_stats.net_profit + p_net_profit,
      biggest_pot_won = greatest(public.season_stats.biggest_pot_won, p_amount_won),
      updated_at = now();
  end if;

  return true;
end;
$$;

revoke all on function public.record_hand_result(uuid, integer, uuid, boolean, integer, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.record_hand_result(uuid, integer, uuid, boolean, integer, integer, boolean)
  to service_role;

-- Closes the active season if its window has passed, archives the top ten by
-- net profit into season_results with a rank-shaped badge, grants each of
-- them a permanent profile_badges row, and opens the next 30-day season
-- starting now. Returns the closed season's id, or null if none was due --
-- the cron route uses that to tell "rolled over" from "not due yet" apart.
--
-- One function, one transaction: a season is never left half-closed with a
-- new one failing to open, because either both happen or neither does.
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

-- The first season, so the app has an active one from the moment this
-- migration runs rather than needing a manual bootstrap step.
insert into public.seasons (starts_at, ends_at, status)
select now(), now() + interval '30 days', 'active'
where not exists (select 1 from public.seasons where status = 'active');

comment on table public.hand_results is
  'Append-only, idempotent per-seat outcome log. Source of truth for player_stats and season_stats.';
comment on function public.record_hand_result(uuid, integer, uuid, boolean, integer, integer, boolean) is
  'Records one hand''s result once; a repeat call for the same (game, hand, profile) is a no-op.';
comment on function public.rollover_season() is
  'Closes the active season if due, archives its top 10, and opens the next 30-day season. Call from a scheduled job.';
