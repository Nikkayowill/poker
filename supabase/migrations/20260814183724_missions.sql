-- Missions: daily and weekly objectives, small and frequent rewards for
-- actual play rather than only for winning. First piece of the economy/
-- retention redesign to actually ship -- levels, streaks and cosmetics
-- already existed; this was the missing piece. FUTURE_M15_M19.md sketched
-- close to this shape under "M18", a label that later got reused for
-- player_progression instead; this migration is the M18 that was never
-- built, adjusted to this codebase's actual RPC conventions.
--
-- Deliberately its own, narrower reward ledger rather than a shared
-- reward_grants table: achievements are a separate, not-yet-built milestone,
-- and giving it its own ledger shape is that milestone's call to make, not
-- this migration's.

create table public.mission_definitions (
  code text primary key,
  cadence text not null check (cadence in ('daily', 'weekly')),
  -- Free text, not an enum: adding a mission is a migration and a row, not a
  -- migration that also alters a type. lib/missions/events.ts is the only
  -- code that has to agree with these strings.
  metric text not null,
  target integer not null check (target > 0),
  reward_gold integer not null check (reward_gold >= 0),
  -- True only for the "active on N separate days" style metric: a UTC day
  -- counts once no matter how many qualifying events land in it that day.
  dedupe_daily boolean not null default false,
  title text not null,
  description text not null,
  sort_order integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index mission_definitions_cadence_idx
  on public.mission_definitions(cadence) where enabled;

comment on table public.mission_definitions is
  'The mission catalog. Small and admin-tunable -- read fresh per request by lib/server/mission-store.ts, never cached in the client.';

-- Per-player, per-period progress. period_start is a UTC day for a daily
-- mission or a UTC Monday for a weekly one -- a date, not a timestamp, for
-- the same reason player_progression.last_claim_day is one: a period is a
-- question about calendar days, and comparing dates cannot drift the way
-- millisecond arithmetic across a boundary does.
create table public.player_mission_progress (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  mission_code text not null references public.mission_definitions(code) on delete cascade,
  period_start date not null,
  progress integer not null default 0 check (progress >= 0),
  -- Only meaningful when the definition is dedupe_daily: the last UTC day an
  -- event was counted, so a second qualifying event on the same day cannot
  -- double an "active day" bar.
  last_progress_day date,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (profile_id, mission_code, period_start)
);

comment on table public.player_mission_progress is
  'One row per player, mission and period. The read the missions panel polls is by the leading (profile_id, mission_code) columns of the primary key, same as player_progression.';

-- Immutable, mission-scoped reward ledger. NOT named or shaped like a
-- general reward_grants table -- see the header above.
create table public.mission_reward_grants (
  -- Deterministic: 'mission:<code>:<profile_id>:<period_start>'. A retried or
  -- duplicated grant call collides on this key and pays nothing a second
  -- time -- the money-ordering idempotency rule expressed as a key instead
  -- of a version column, because a mission period accumulates rather than
  -- settling once the way a duel match row does.
  idempotency_key text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  mission_code text not null references public.mission_definitions(code),
  period_start date not null,
  gold_amount integer not null check (gold_amount > 0),
  created_at timestamptz not null default now()
);

create index mission_reward_grants_profile_recent_idx
  on public.mission_reward_grants(profile_id, created_at desc);

-- ---------------------------------------------------------------------------
-- apply_mission_progress: one row-locked RPC, matching award_progression_xp's
-- shape exactly -- upsert-then-lock, then a qualified UPDATE, returning
-- everything the caller needs so it never has to re-read to detect a race.
-- ---------------------------------------------------------------------------

create or replace function public.apply_mission_progress(
  p_profile_id uuid,
  p_mission_code text,
  p_period_start date,
  p_delta integer,
  p_event_day date
)
returns table (previous_progress integer, new_progress integer, target integer, newly_completed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target integer;
  v_dedupe boolean;
  v_progress integer;
  v_completed_at timestamptz;
  v_last_day date;
  v_new integer;
begin
  if p_delta is null or p_delta <= 0 then
    raise exception 'Invalid mission progress delta' using errcode = '22023';
  end if;

  select md.target, md.dedupe_daily into v_target, v_dedupe
  from public.mission_definitions as md
  where md.code = p_mission_code
    and md.enabled
    and (md.starts_at is null or md.starts_at <= now())
    and (md.ends_at is null or md.ends_at >= now());
  if not found then
    -- Unknown, disabled, or out of its active window: a silent no-op rather
    -- than an error, so retiring a mission mid-period cannot turn an
    -- ordinary hand, duel or puzzle into a failed request.
    return;
  end if;

  insert into public.player_mission_progress (profile_id, mission_code, period_start)
  values (p_profile_id, p_mission_code, p_period_start)
  on conflict (profile_id, mission_code, period_start) do nothing;

  select pmp.progress, pmp.completed_at, pmp.last_progress_day
    into v_progress, v_completed_at, v_last_day
  from public.player_mission_progress as pmp
  where pmp.profile_id = p_profile_id
    and pmp.mission_code = p_mission_code
    and pmp.period_start = p_period_start
  for update;

  if v_completed_at is not null then
    return query select v_progress, v_progress, v_target, false;
    return;
  end if;

  if v_dedupe and v_last_day is not null and v_last_day = p_event_day then
    return query select v_progress, v_progress, v_target, false;
    return;
  end if;

  v_new := least(v_target, v_progress + p_delta);

  update public.player_mission_progress
  set progress = v_new,
      completed_at = case when v_new >= v_target then now() else completed_at end,
      last_progress_day = case when v_dedupe then p_event_day else last_progress_day end,
      updated_at = now()
  where profile_id = p_profile_id
    and mission_code = p_mission_code
    and period_start = p_period_start;

  return query select v_progress, v_new, v_target, (v_new >= v_target);
end;
$$;

revoke all on function public.apply_mission_progress(uuid, text, date, integer, date)
  from public, anon, authenticated;
grant execute on function public.apply_mission_progress(uuid, text, date, integer, date)
  to service_role;

-- ---------------------------------------------------------------------------
-- grant_mission_reward: the ledger insert and the Gold credit in one
-- transaction. Auto-credited the moment a mission completes -- there is no
-- claim step (see lib/server/mission-store.ts for why) -- so unlike
-- awardWager's deliberately-split XP-then-credit, dropping this on a retry
-- would silently undercut the whole feature's "small and frequent" premise
-- rather than costing one rare, logged event. Calls the already-guarded
-- credit_gold_by_profile (20260812120000) from inside its own transaction,
-- which is an ordinary nested call, not a second lock on the profile row.
-- ---------------------------------------------------------------------------

create or replace function public.grant_mission_reward(
  p_profile_id uuid,
  p_mission_code text,
  p_period_start date,
  p_gold_amount integer
)
returns table (granted boolean, gold_balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_rows integer;
  v_success boolean;
  v_balance integer;
begin
  if p_gold_amount is null or p_gold_amount <= 0 then
    raise exception 'Invalid mission reward amount' using errcode = '22023';
  end if;

  v_key := 'mission:' || p_mission_code || ':' || p_profile_id::text || ':' || p_period_start::text;

  insert into public.mission_reward_grants (idempotency_key, profile_id, mission_code, period_start, gold_amount)
  values (v_key, p_profile_id, p_mission_code, p_period_start, p_gold_amount)
  on conflict (idempotency_key) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    -- Already granted: report the current balance rather than crediting
    -- again -- the same "a lost race did not happen" contract as spend_gold.
    select p.gold_balance into v_balance from public.profiles as p where p.id = p_profile_id;
    return query select false, coalesce(v_balance, 0);
    return;
  end if;

  select c.success, c.gold_balance into v_success, v_balance
  from public.credit_gold_by_profile(p_profile_id, p_gold_amount) as c;

  return query select v_success, v_balance;
end;
$$;

revoke all on function public.grant_mission_reward(uuid, text, date, integer)
  from public, anon, authenticated;
grant execute on function public.grant_mission_reward(uuid, text, date, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- Access. Same posture as player_progression: RLS on, no grants -- every
-- read goes through a server route using the admin client, and RLS being on
-- with no policy means a later grant alone still returns nothing.
-- ---------------------------------------------------------------------------

alter table public.mission_definitions enable row level security;
alter table public.player_mission_progress enable row level security;
alter table public.mission_reward_grants enable row level security;
revoke all on public.mission_definitions from anon, authenticated;
revoke all on public.player_mission_progress from anon, authenticated;
revoke all on public.mission_reward_grants from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Starter catalog. Idempotent on code. Mirrored in TypeScript by
-- lib/server/mission-store.ts's DEFAULT_DEFINITIONS for the no-Supabase
-- memory-mode path -- the same duplication every memory-mode store here
-- carries against its own table's defaults.
--
-- Sizing: a full daily sweep pays ~550 Gold against the base daily claim's
-- 1,000-2,500 with streak; a full weekly sweep pays ~4,650 against rewarded
-- ads' ~21,000/week ceiling. Missions stay a modest, secondary faucet.
-- ---------------------------------------------------------------------------

insert into public.mission_definitions
  (code, cadence, metric, target, reward_gold, dedupe_daily, title, description, sort_order)
values
  ('daily_play_hands', 'daily', 'poker_hands_played', 5, 150, false,
   'Play five poker hands', 'Sit in and see five hands to showdown or fold.', 10),
  ('daily_win_duels', 'daily', 'duels_won', 3, 150, false,
   'Win three duels', 'Win three PvP duels -- any game.', 20),
  ('daily_brain_game', 'daily', 'puzzles_completed', 1, 100, false,
   'Complete one brain game', 'Finish a Wordle, Sudoku, Connections or Memory round.', 30),
  ('daily_multiplayer', 'daily', 'multiplayer_hands_played', 1, 150, false,
   'Play with real players', 'Play a poker hand at a table with another real player.', 40),
  ('weekly_win_duels', 'weekly', 'duels_won', 10, 1000, false,
   'Win ten duels', 'Win ten PvP duels this week.', 10),
  ('weekly_active_days', 'weekly', 'active_day', 5, 1200, true,
   'Show up five days', 'Play something on five separate days this week.', 20),
  ('weekly_cross_category', 'weekly', 'games_played_any', 20, 1500, false,
   'Play twenty games', 'Complete twenty games across poker, duels and brain games.', 30),
  ('weekly_level_up', 'weekly', 'levels_gained', 1, 800, false,
   'Rank up', 'Gain a rank level this week.', 40)
on conflict (code) do nothing;
