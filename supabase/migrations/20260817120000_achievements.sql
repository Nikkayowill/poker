-- Achievements & badges: milestone 2 of the economy/retention redesign.
-- Missions (20260814120000) pay small and often for *doing* things; this
-- pays once, and bigger, for *lifetime* thresholds -- the "you've been here
-- a while" faucet. Three tables, two RPCs, the same shape missions
-- established: a catalog, a per-player record of where they stand, and an
-- immutable reward ledger the money-ordering rules require.
--
-- Deliberately its own reward ledger (achievement_grants), not
-- mission_reward_grants and not profile_badges -- see that migration's own
-- header, which reserves this shape for exactly this milestone to decide.
-- profile_badges IS reused, but only for what it already is: public-read
-- badge flair. Its season_id column is already nullable for a non-seasonal
-- badge, so an achievement badge is 'achievement-<code>' with season_id
-- null, written by the grant RPC below alongside the ledger row -- not a
-- second badges-shaped table.

-- ---------------------------------------------------------------------------
-- Catalog. Admin-tunable, read fresh per request by
-- lib/server/achievement-store.ts, same posture as mission_definitions.
-- ---------------------------------------------------------------------------

create table public.achievement_definitions (
  code text primary key,
  category text not null,
  tier smallint not null check (tier between 1 and 3),
  -- 'stat'    reads player_stats (hands_played, hands_won, net_profit,
  --           biggest_pot_won, total_chips_won) -- already a running total,
  --           already what avatar-unlocks.ts reads for the same reason.
  -- 'counter' reads player_lifetime_counters -- duels_won and
  --           puzzles_completed have no stored lifetime number anywhere
  --           else, so this migration is what starts counting them.
  -- 'live'    reads the player's current level, computed fresh from
  --           player_progression.xp -- not counted, because a stored
  --           "levels gained" total is a second number that could drift
  --           from the level the rank bar already shows.
  source_kind text not null check (source_kind in ('stat', 'counter', 'live')),
  -- Free text, matched by lib/achievements/types.ts's reader, same "a
  -- migration and a row, not a migration that also alters a type" reasoning
  -- mission_definitions.metric restates.
  metric text not null,
  threshold bigint not null check (threshold > 0),
  reward_gold integer not null default 0 check (reward_gold >= 0),
  -- lib/cosmetics/catalog.ts id, or null. Not a foreign key: the catalog is
  -- TypeScript, same reason player_cosmetics.cosmetic_id isn't one either.
  reward_cosmetic_id text,
  title text not null,
  description text not null,
  sort_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index achievement_definitions_category_idx
  on public.achievement_definitions(category, tier) where enabled;

comment on table public.achievement_definitions is
  'The achievement catalog: tiered, lifetime milestones. Mirrored in TypeScript by lib/server/achievement-store.ts''s DEFAULT_DEFINITIONS for memory mode, same duplication every memory-mode store here carries.';

-- ---------------------------------------------------------------------------
-- Lifetime counters for the two metrics with no stored number yet. Generic
-- on (profile_id, metric) rather than one row per achievement -- all three
-- duels_won tiers, say, read the same count.
-- ---------------------------------------------------------------------------

create table public.player_lifetime_counters (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  metric text not null,
  count bigint not null default 0 check (count >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, metric)
);

comment on table public.player_lifetime_counters is
  'Event-driven lifetime counts for metrics that are not already a running total elsewhere (duels_won, puzzles_completed). hands_played/hands_won/net_profit/biggest_pot_won/total_chips_won live in player_stats already and never write here.';

-- ---------------------------------------------------------------------------
-- Immutable, achievement-scoped reward ledger. PK doubles as the
-- idempotency key -- there is no period component the way a mission has, so
-- (profile_id, achievement_code) is the direct expression of "this grant,
-- once", not a synthesized text key.
-- ---------------------------------------------------------------------------

create table public.achievement_grants (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  achievement_code text not null references public.achievement_definitions(code),
  gold_amount integer not null default 0 check (gold_amount >= 0),
  cosmetic_id text,
  awarded_at timestamptz not null default now(),
  primary key (profile_id, achievement_code)
);

create index achievement_grants_profile_recent_idx
  on public.achievement_grants(profile_id, awarded_at desc);

comment on table public.achievement_grants is
  'One row per (profile, achievement) ever granted -- the idempotency guard for grant_achievement_reward and the source of "which achievements has this player unlocked". profile_badges gets a parallel row for public display; this is the ledger of record.';

-- ---------------------------------------------------------------------------
-- apply_achievement_counter: bumps a lifetime counter. Simpler than
-- apply_mission_progress -- there is no per-definition target or window to
-- check here, since one counter feeds three tiers; the store layer decides
-- which tiers that crossed against the catalog after reading the new count
-- back via checkAchievements. The insert...on conflict do update...
-- returning is itself the row lock; no separate SELECT...FOR UPDATE needed.
-- ---------------------------------------------------------------------------

create or replace function public.apply_achievement_counter(
  p_profile_id uuid,
  p_metric text,
  p_delta integer
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  if p_delta is null or p_delta <= 0 then
    raise exception 'Invalid achievement counter delta' using errcode = '22023';
  end if;

  insert into public.player_lifetime_counters (profile_id, metric, count)
  values (p_profile_id, p_metric, p_delta)
  on conflict (profile_id, metric)
  do update set count = public.player_lifetime_counters.count + p_delta,
                updated_at = now()
  returning count into v_count;

  return v_count;
end;
$$;

revoke all on function public.apply_achievement_counter(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.apply_achievement_counter(uuid, text, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- grant_achievement_reward: the ledger insert, the badge row, the optional
-- cosmetic, and the Gold credit, all in one function invocation -- which is
-- one transaction, so a mid-function error rolls back every write in it,
-- including the ledger insert. That is what makes it safe to do the
-- side-effecting inserts *after* the ledger check rather than needing a
-- second idempotency guard around each of them: the ledger row and its
-- side effects always commit or roll back together.
--
-- Same on-conflict-do-nothing + row-count shape as grant_mission_reward.
-- Calls credit_gold_by_profile (20260812120000) only when there is Gold to
-- pay -- that function itself rejects a zero amount.
-- ---------------------------------------------------------------------------

create or replace function public.grant_achievement_reward(
  p_profile_id uuid,
  p_achievement_code text,
  p_gold_amount integer,
  p_cosmetic_id text default null
)
returns table (granted boolean, gold_balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
  v_success boolean;
  v_balance integer;
begin
  if p_gold_amount is null or p_gold_amount < 0 then
    raise exception 'Invalid achievement reward amount' using errcode = '22023';
  end if;

  insert into public.achievement_grants (profile_id, achievement_code, gold_amount, cosmetic_id)
  values (p_profile_id, p_achievement_code, p_gold_amount, p_cosmetic_id)
  on conflict (profile_id, achievement_code) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    -- Already granted: the same "a lost race did not happen" contract as
    -- spend_gold and grant_mission_reward -- report the current balance
    -- rather than crediting, or awarding the cosmetic, a second time.
    select p.gold_balance into v_balance from public.profiles as p where p.id = p_profile_id;
    return query select false, coalesce(v_balance, 0);
    return;
  end if;

  if p_cosmetic_id is not null then
    insert into public.player_cosmetics (profile_id, cosmetic_id, source)
    values (p_profile_id, p_cosmetic_id, 'award')
    on conflict (profile_id, cosmetic_id) do nothing;
  end if;

  -- Public flair, alongside the season-rollover badges rollover_season()
  -- already writes here. season_id null: this badge belongs to no season.
  insert into public.profile_badges (profile_id, badge, season_id)
  values (p_profile_id, 'achievement-' || p_achievement_code, null)
  on conflict (profile_id, badge) do nothing;

  if p_gold_amount > 0 then
    select c.success, c.gold_balance into v_success, v_balance
    from public.credit_gold_by_profile(p_profile_id, p_gold_amount) as c;
  else
    select p.gold_balance into v_balance from public.profiles as p where p.id = p_profile_id;
    v_success := true;
  end if;

  return query select v_success, v_balance;
end;
$$;

revoke all on function public.grant_achievement_reward(uuid, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.grant_achievement_reward(uuid, text, integer, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Access. achievement_definitions / player_lifetime_counters /
-- achievement_grants: RLS on, no grants -- server (service-role) only,
-- served through app/api/achievements. profile_badges keeps its existing
-- public-select grant unchanged; player_cosmetics keeps its existing
-- revoke-all unchanged.
-- ---------------------------------------------------------------------------

alter table public.achievement_definitions enable row level security;
alter table public.player_lifetime_counters enable row level security;
alter table public.achievement_grants enable row level security;
revoke all on public.achievement_definitions from anon, authenticated;
revoke all on public.player_lifetime_counters from anon, authenticated;
revoke all on public.achievement_grants from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Starter catalog: 8 categories x 3 tiers = 24 achievements.
--
-- Sizing against what already exists: a full daily+weekly mission sweep pays
-- ~550/~4,650 Gold; avatarCosmetics run 25,000 (cheapest card back) to
-- 7,000,000 (priciest avatar). Achievement tiers scale 300 -> 25,000 Gold
-- across the three tiers of a category -- a tier-1 (a few days of play)
-- pays about one full daily sweep, a tier-3 (thousands of hands / a
-- million net profit / level 50 of 100) pays ~5x a full weekly sweep. The
-- whole 24-achievement catalog sums to roughly 167,000 Gold lifetime --
-- meaningful completion bragging rights, nowhere near enough to buy the
-- catalog's expensive cosmetics outright, and mostly reachable only by
-- players already deep into the game.
--
-- back-riverwood ("thousand hands") and avatar-housename ("High-stakes
-- pot", redefined here as 50,000+ chips in one pot) are the only two
-- reward_cosmetic_id values -- avatar-finaltable and avatar-ace stay
-- exactly as they are today, out of scope.
-- ---------------------------------------------------------------------------

insert into public.achievement_definitions
  (code, category, tier, source_kind, metric, threshold, reward_gold, reward_cosmetic_id, title, description, sort_order)
values
  ('hands_played_100',   'hands_played',      1, 'stat',    'hands_played',      100,      300,   null,               'Ante Up',             'Play 100 hands.', 11),
  ('hands_played_1000',  'hands_played',      2, 'stat',    'hands_played',      1000,     1500,  'back-riverwood',   'Regular',             'Play 1,000 hands in this room.', 12),
  ('hands_played_10000', 'hands_played',      3, 'stat',    'hands_played',      10000,    15000, null,               'Lifer',               'Play 10,000 hands in this room.', 13),

  ('hands_won_50',       'hands_won',         1, 'stat',    'hands_won',         50,       300,   null,               'First Blood',         'Win 50 hands.', 21),
  ('hands_won_500',      'hands_won',         2, 'stat',    'hands_won',         500,      1500,  null,               'Sharp',               'Win 500 hands.', 22),
  ('hands_won_5000',     'hands_won',         3, 'stat',    'hands_won',         5000,     15000, null,               'Grinder''s Edge',     'Win 5,000 hands.', 23),

  ('net_profit_10k',     'net_profit',        1, 'stat',    'net_profit',        10000,    500,   null,               'In The Black',        'Reach 10,000 lifetime net profit.', 31),
  ('net_profit_100k',    'net_profit',        2, 'stat',    'net_profit',        100000,   3000,  null,               'Building A Bankroll', 'Reach 100,000 lifetime net profit.', 32),
  ('net_profit_1m',      'net_profit',        3, 'stat',    'net_profit',        1000000,  25000, null,               'High Roller',         'Reach 1,000,000 lifetime net profit.', 33),

  ('biggest_pot_10k',    'biggest_pot_won',   1, 'stat',    'biggest_pot_won',   10000,    500,   null,               'Nice Pot',            'Win a single pot of 10,000 chips or more.', 41),
  ('biggest_pot_50k',    'biggest_pot_won',   2, 'stat',    'biggest_pot_won',   50000,    3000,  'avatar-housename', 'House Name',          'Win a single high-stakes pot of 50,000 chips or more.', 42),
  ('biggest_pot_250k',   'biggest_pot_won',   3, 'stat',    'biggest_pot_won',   250000,   25000, null,               'The Big One',         'Win a single pot of 250,000 chips or more.', 43),

  ('chips_won_100k',     'total_chips_won',   1, 'stat',    'total_chips_won',   100000,   300,   null,               'Getting Started',     'Win 100,000 chips lifetime.', 51),
  ('chips_won_1m',       'total_chips_won',   2, 'stat',    'total_chips_won',   1000000,  1500,  null,               'Millionaire',         'Win 1,000,000 chips lifetime.', 52),
  ('chips_won_10m',      'total_chips_won',   3, 'stat',    'total_chips_won',   10000000, 15000, null,               'Empire',              'Win 10,000,000 chips lifetime.', 53),

  ('duels_won_10',       'duels_won',         1, 'counter', 'duels_won',         10,       500,   null,               'Duelist',             'Win 10 PvP duels.', 61),
  ('duels_won_50',       'duels_won',         2, 'counter', 'duels_won',         50,       2500,  null,               'Gunslinger',          'Win 50 PvP duels.', 62),
  ('duels_won_250',      'duels_won',         3, 'counter', 'duels_won',         250,      20000, null,               'Undefeated',          'Win 250 PvP duels.', 63),

  ('puzzles_completed_10',  'puzzles_completed', 1, 'counter', 'puzzles_completed', 10,  300,   null, 'Warming Up',     'Complete 10 brain games.', 71),
  ('puzzles_completed_100', 'puzzles_completed', 2, 'counter', 'puzzles_completed', 100, 1500,  null, 'Puzzle Regular', 'Complete 100 brain games.', 72),
  ('puzzles_completed_500', 'puzzles_completed', 3, 'counter', 'puzzles_completed', 500, 12000, null, 'Puzzle Master',  'Complete 500 brain games.', 73),

  ('level_10', 'levels_gained', 1, 'live', 'profile_level', 10, 500,   null, 'On The Board',       'Reach level 10.', 81),
  ('level_25', 'levels_gained', 2, 'live', 'profile_level', 25, 2500,  null, 'Made Man',            'Reach level 25.', 82),
  ('level_50', 'levels_gained', 3, 'live', 'profile_level', 50, 20000, null, 'Legend Of The Room',  'Reach level 50.', 83)
on conflict (code) do nothing;
