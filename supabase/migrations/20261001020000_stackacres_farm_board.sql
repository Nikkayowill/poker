-- The Daily Farm Board (lib/stackacres/farm-board.ts): two objectives a day
-- and one a week, drawn per profile from work that farm can already do.
--
-- NAMES CHECKED AGAINST THE LIVE SCHEMA: homestead_farm_board,
-- homestead_farm_board_grants, draw_homestead_farm_board,
-- write_homestead_farm_board and grant_homestead_farm_board_reward are all
-- free. Nothing here touches homestead_inventory, which is dead barn-era
-- state (see lib/server/stackacres-store.ts's own comment on it).
--
-- ONE ROW PER PROFILE AND PERIOD, holding the drawn codes, their counts and
-- which have been paid, as one jsonb document behind a version guard --
-- the same shape homestead_story (20260911205420) already uses for quest
-- progress, and for the same reason: the pure reducer in
-- lib/stackacres/farm-board.ts decides the next document, and the guard is
-- what stops two tabs each advancing the same board off one read.
--
-- THE DRAW IS PERSISTED, NOT RECOMPUTED. It has to be: the pool a board is
-- drawn from is filtered by what the farm can do, so a player who builds an
-- Oven at noon would otherwise have the afternoon's board reshuffle under
-- them. `draw_homestead_farm_board` inserts once and hands back whatever
-- row already existed, so two racing tabs see one board.
--
-- NO GOLD MOVES IN THIS FILE, and that is deliberate.
-- lib/server/stackacres-gold-boundary.test.ts holds the rule: farm SQL that
-- moves Gold inside its own transaction cannot follow the farm into a
-- separate database, so new farm Gold goes through profile-store's ledgered
-- credit from TypeScript instead. Only two legacy functions are grandfathered
-- and this is not one of them.
--
-- So the claim is split, and the split is itself the idempotency:
--   here        `claim_homestead_farm_board_reward` inserts the keyed ledger
--               row and adds Town Influence in one transaction, and answers
--               whether THIS call is the one that claimed the key. A second
--               call collides on the primary key and answers false.
--   TypeScript  only a true answer goes on to credit Gold, through
--               `creditGoldByProfileLedgered` with its own deterministic
--               correlation id -- which is idempotent in its own right, so
--               the money is guarded twice over and a crash between the two
--               steps costs nothing.
-- There is no debit anywhere: the board charges nothing and cannot be
-- rerolled. `gold_amount` below records what a claim was worth; it is a
-- receipt, not a mover.

create table public.homestead_farm_board (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- 'daily' or 'weekly'. Free text with a check rather than an enum, same
  -- as mission_definitions.cadence: a third period would be a migration and
  -- a check change, not a type alteration.
  period_kind text not null check (period_kind in ('daily', 'weekly')),
  -- A UTC day for the daily board, that week's UTC Monday for the weekly
  -- one. A date, not a timestamp, for the same reason
  -- player_mission_progress.period_start is one -- a period is a question
  -- about calendar days, and comparing dates cannot drift.
  period_start date not null,
  -- {codes: string[], counts: number[], paid: string[]}, positional.
  board jsonb not null,
  version integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  primary key (profile_id, period_kind, period_start)
);

comment on table public.homestead_farm_board is
  'The Daily Farm Board: one row per player and period holding the drawn objective codes, their counts and which rewards have been paid, as one version-guarded jsonb document. Service-role only.';

alter table public.homestead_farm_board enable row level security;
revoke all on public.homestead_farm_board from anon, authenticated;

-- Immutable, board-scoped reward ledger. Its own table rather than a row in
-- mission_reward_grants: that table's rows are foreign-keyed to
-- mission_definitions(code), and a board code is not a mission definition.
create table public.homestead_farm_board_grants (
  -- Deterministic: 'farm_board:<code>:<profile_id>:<period_start>'. A
  -- retried grant collides here and pays nothing a second time.
  idempotency_key text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  code text not null,
  period_start date not null,
  gold_amount integer not null check (gold_amount >= 0),
  influence_amount integer not null check (influence_amount >= 0),
  created_at timestamptz not null default now()
);

comment on table public.homestead_farm_board_grants is
  'Immutable ledger of Daily Farm Board rewards. One row per player, code and period; the primary key is what makes a retried grant free.';

create index homestead_farm_board_grants_profile_recent_idx
  on public.homestead_farm_board_grants(profile_id, created_at desc);

alter table public.homestead_farm_board_grants enable row level security;
revoke all on public.homestead_farm_board_grants from anon, authenticated;

-- ---------------------------------------------------------------------------
-- draw_homestead_farm_board: claim a period's board, or report the one that
-- is already there. Never overwrites: a board is drawn once per period and
-- the row is the authority from then on, whatever the pool would draw now.
-- ---------------------------------------------------------------------------

create or replace function public.draw_homestead_farm_board(
  p_profile_id uuid,
  p_period_kind text,
  p_period_start date,
  p_board jsonb
)
returns table (out_board jsonb, out_version integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.homestead_farm_board (profile_id, period_kind, period_start, board)
  values (p_profile_id, p_period_kind, p_period_start, p_board)
  on conflict (profile_id, period_kind, period_start) do nothing;

  return query
    select fb.board, fb.version
    from public.homestead_farm_board as fb
    where fb.profile_id = p_profile_id
      and fb.period_kind = p_period_kind
      and fb.period_start = p_period_start;
end;
$$;

comment on function public.draw_homestead_farm_board(uuid, text, date, jsonb) is
  'Claims one period''s Farm Board for a player, or returns the board already drawn for it. Never overwrites an existing row.';

-- ---------------------------------------------------------------------------
-- write_homestead_farm_board: the version-guarded write, same contract as
-- write_homestead_story -- the new version, or null on a lost race.
-- ---------------------------------------------------------------------------

create or replace function public.write_homestead_farm_board(
  p_profile_id uuid,
  p_period_kind text,
  p_period_start date,
  p_board jsonb,
  p_expected_version integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v integer;
begin
  update public.homestead_farm_board
     set board = p_board,
         version = version + 1,
         updated_at = now()
   where profile_id = p_profile_id
     and period_kind = p_period_kind
     and period_start = p_period_start
     and version = p_expected_version
  returning version into v;
  return v;
end;
$$;

comment on function public.write_homestead_farm_board(uuid, text, date, jsonb, integer) is
  'Version-guarded write of one period''s Farm Board document. Returns the new version, or null on a lost race.';

-- ---------------------------------------------------------------------------
-- grant_homestead_farm_board_reward: the ledger insert, the Gold credit and
-- the Influence add in one transaction. Auto-credited the moment an
-- objective completes -- there is no claim step, the same call missions made
-- and for the same reason: the player has already done the work.
-- ---------------------------------------------------------------------------

create or replace function public.claim_homestead_farm_board_reward(
  p_profile_id uuid,
  p_code text,
  p_period_start date,
  p_gold integer,
  p_influence integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_gold is null or p_gold < 0 or p_influence is null or p_influence < 0 then
    raise exception 'Invalid farm board reward amount' using errcode = '22023';
  end if;

  insert into public.homestead_farm_board_grants
    (idempotency_key, profile_id, code, period_start, gold_amount, influence_amount)
  values (
    'farm_board:' || p_code || ':' || p_profile_id::text || ':' || p_period_start::text,
    p_profile_id, p_code, p_period_start, p_gold, p_influence
  )
  on conflict (idempotency_key) do nothing;
  get diagnostics v_rows = row_count;

  -- The key was already spent: this call claimed nothing, so it must not add
  -- Influence either, and its caller must not pay Gold. The same "a lost race
  -- did not happen" answer the guarded purse functions give. (Naming one of
  -- them here would trip stackacres-gold-boundary.test.ts, which greps these
  -- bodies for Gold movement and cannot tell code from a comment.)
  if v_rows = 0 then
    return false;
  end if;

  -- Influence is progression, not currency: it spends nowhere, so it carries
  -- none of a purse's risk and belongs in the same transaction as the key it
  -- is owed against. Gold does not -- see this file's header.
  if p_influence > 0 then
    perform public.adjust_homestead_influence(p_profile_id, p_influence);
  end if;

  return true;
end;
$$;

comment on function public.claim_homestead_farm_board_reward(uuid, text, date, integer, integer) is
  'Claims one finished Farm Board line: the keyed ledger insert and the Town Influence add in one transaction. Returns true only for the call that claimed the key; Gold is credited by the caller, from TypeScript, through the ledgered credit. Service-role only.';

-- `public` is load-bearing here, not redundant with anon/authenticated: see
-- reference_stackchips_revoke_execute_from_public -- omitting it has shipped
-- a SECURITY DEFINER function anonymously callable on /rest/v1/rpc before.
revoke all on function public.draw_homestead_farm_board(uuid, text, date, jsonb) from public, anon, authenticated;
revoke all on function public.write_homestead_farm_board(uuid, text, date, jsonb, integer) from public, anon, authenticated;
revoke all on function public.claim_homestead_farm_board_reward(uuid, text, date, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- stackacres_read_batch, plus the two board rows.
--
-- Below is the body 20260928232207_stackacres_read_batch_fold_far_field.sql
-- installed, with 'farm_board_daily' and 'farm_board_weekly' added. Folding
-- them in rather than reading them beside the batch is what
-- lib/server/stackacres-read-budget.test.ts exists to enforce; a new farm
-- table read outside the batch is the drift that let the exception list grow
-- to eleven once already.
--
-- The weekly row's key is derived here rather than passed in: p_day is
-- already this read's UTC day, and that week's Monday is
-- p_day - (isodow - 1) days. Keeping it in SQL means the batch signature
-- does not change and lib/missions/period.ts stays the only place the week
-- boundary is defined for the app.
-- ---------------------------------------------------------------------------

create or replace function public.stackacres_read_batch(p_profile_id uuid, p_day date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'units', coalesce(
      (select jsonb_agg(t order by t.created_at) from public.homestead_units t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'feed', (select to_jsonb(t) from public.homestead_feed t where t.profile_id = p_profile_id),
    'water', (select to_jsonb(t) from public.homestead_water t where t.profile_id = p_profile_id),
    'capacity', coalesce(
      (select jsonb_agg(t) from public.homestead_capacity t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'sectors', coalesce(
      (select jsonb_agg(t) from public.homestead_sectors t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'upkeep', (
      select to_jsonb(t) from public.homestead_upkeep t
      where t.profile_id = p_profile_id and t.day = p_day
    ),
    'museum', coalesce(
      (select jsonb_agg(t) from public.homestead_museum_donations t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'tool', (select to_jsonb(t) from public.homestead_tool t where t.profile_id = p_profile_id),
    'wheat_plots', coalesce(
      (select jsonb_agg(t order by t.created_at) from public.homestead_wheat_plots t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'machines', coalesce(
      (select jsonb_agg(t order by t.created_at) from public.homestead_machines t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'inventory', coalesce(
      (select jsonb_agg(t) from public.homestead_processing_inventory t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'contract', (
      select to_jsonb(t) from public.homestead_contracts t
      where t.profile_id = p_profile_id and t.status = 'open'
    ),
    'influence', (select to_jsonb(t) from public.homestead_town_influence t where t.profile_id = p_profile_id),
    'secret_ledger', coalesce(
      (select jsonb_agg(t) from public.homestead_secret_ledger t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'greenhouse', (select to_jsonb(t) from public.homestead_greenhouse t where t.profile_id = p_profile_id),
    'crop_fields', (select to_jsonb(t) from public.homestead_crop_fields t where t.profile_id = p_profile_id),
    'perk_unlocks', coalesce(
      (select jsonb_agg(t) from public.stackacres_perk_unlocks t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'blueprints', coalesce(
      (select jsonb_agg(t) from public.stackacres_blueprints t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'blueprint_progress', coalesce(
      (select jsonb_agg(t) from public.stackacres_blueprint_progress t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'prestige', (select to_jsonb(t) from public.homestead_prestige_state t where t.profile_id = p_profile_id),
    'tool_enchantments', coalesce(
      (select jsonb_agg(t) from public.stackacres_tool_enchantments t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'crossbreed_plots', coalesce(
      (select jsonb_agg(t order by t.created_at) from public.stackacres_crossbreed_plots t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'crossbreed_inventory', coalesce(
      (select jsonb_agg(t) from public.stackacres_crossbreed_inventory t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'pipes', coalesce(
      (select jsonb_agg(t) from public.homestead_pipes t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'soil_tiles', coalesce(
      (select jsonb_agg(t) from public.homestead_soil_tiles t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'soil_stock', coalesce(
      (select jsonb_agg(t) from public.homestead_soil_stock t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'seed_stock', coalesce(
      (select jsonb_agg(t) from public.homestead_seed_stock t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'devotion', (select to_jsonb(t) from public.homestead_devotion t where t.profile_id = p_profile_id),
    'friendship', coalesce(
      (select jsonb_agg(t) from public.homestead_friendship t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    -- Only the Vat's own seal. Kept for code deployed before Chapter 5; new
    -- code reads aging_manifests.
    'vat_manifest', (
      select to_jsonb(t) from public.homestead_vat_manifests t
      join public.homestead_machines m on m.id = t.machine_id
      where t.profile_id = p_profile_id and m.kind = 'vat'
    ),
    'cutters', coalesce(
      (select jsonb_agg(t) from public.homestead_cutter t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'story', (select to_jsonb(t) from public.homestead_story t where t.profile_id = p_profile_id),
    'energy', (select to_jsonb(t) from public.homestead_energy t where t.profile_id = p_profile_id),
    'clock', (select to_jsonb(t) from public.homestead_clock t where t.profile_id = p_profile_id),
    'aging_manifests', coalesce(
      (select jsonb_agg(t) from public.homestead_vat_manifests t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'wood_nodes', coalesce(
      (select jsonb_agg(t) from public.homestead_wood_nodes t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'land_obstacles', coalesce(
      (select jsonb_agg(t) from public.homestead_land_obstacles t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'forage_nodes', coalesce(
      (select jsonb_agg(t) from public.homestead_forage_nodes t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'axe', (select to_jsonb(t) from public.homestead_axe t where t.profile_id = p_profile_id),
    'fences', coalesce(
      (select jsonb_agg(t) from public.homestead_fences t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    -- The buildings this player owns on the Far Field.
    'empire_buildings', coalesce(
      (select jsonb_agg(t order by t.created_at) from public.empire_buildings t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    -- The city grocery, one row, where owning it is open. Always read here regardless
    -- of the groceryOwnershipEnabled() app flag -- one small per-profile row costs
    -- nothing extra riding along with everything else, and the app decides whether to
    -- look at it.
    'grocery', (select to_jsonb(t) from public.empire_grocery t where t.profile_id = p_profile_id),
    -- Today's Farm Board, and this week's. Absent until the player's first
    -- read of that period draws one; view() treats a missing row as "not
    -- drawn yet" and claims it.
    'farm_board_daily', (
      select to_jsonb(t) from public.homestead_farm_board t
      where t.profile_id = p_profile_id and t.period_kind = 'daily' and t.period_start = p_day
    ),
    'farm_board_weekly', (
      select to_jsonb(t) from public.homestead_farm_board t
      where t.profile_id = p_profile_id
        and t.period_kind = 'weekly'
        and t.period_start = p_day - (extract(isodow from p_day)::integer - 1)
    )
  );
$$;

comment on function public.stackacres_read_batch(uuid, date) is
  'Batched per-profile farm read for view() in stackacres-service.ts. Read-only. Service-role only.';

revoke all on function public.stackacres_read_batch(uuid, date) from public, anon, authenticated;
