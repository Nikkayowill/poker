-- StackAcres is a family farm now, not a fantasy RPG. This drops the six
-- systems that went with the old direction: the Synergy Tree perks, the
-- Sunlight Forge enchantments, the Crossbreeding Bed, the Prestige Reset
-- Valve, the Pixel Pilgrim's devotion and shrine, and the Mythic Blueprints.
-- The app no longer reads or writes any of them.
--
-- Order matters. stackacres_read_batch reads every one of these tables, so it
-- is redefined without them first; a SQL function that still named a dropped
-- table would fail on its next call. Then the RPCs, then the tables.
-- Nothing else in the schema references these tables (checked against every
-- migration). No data is kept or refunded: the only rows are test farms.

-- ---------------------------------------------------------------------------
-- stackacres_read_batch, without the dropped systems.
--
-- The body 20261001204826_stackacres_acres.sql installed, minus 'perk_unlocks',
-- 'blueprints', 'blueprint_progress', 'prestige', 'tool_enchantments',
-- 'crossbreed_plots', 'crossbreed_inventory' and 'devotion'.
-- (lib/server/stackacres-read-budget.test.ts reads this file.)
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
    -- The guard dogs on this player's Homestead (lib/stackacres/guard-dog.ts).
    -- Carried forward from 20261001195736_stackacres_guard_dogs.sql, which
    -- added this key; this body replaces that one, so it has to keep it.
    'guard_dogs', coalesce(
      (select jsonb_agg(t order by t.created_at) from public.homestead_guard_dogs t where t.profile_id = p_profile_id),
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
    -- The wild acres this player owns (lib/stackacres/acres.ts).
    'acres', coalesce(
      (select jsonb_agg(t order by t.acre_id) from public.homestead_acres t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
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

-- ---------------------------------------------------------------------------
-- The RPCs.
-- ---------------------------------------------------------------------------

drop function if exists public.unlock_stackacres_perk(uuid, text, integer);
drop function if exists public.activate_stackacres_session_perk(uuid, text, smallint);
drop function if exists public.get_active_stackacres_synergies(uuid, integer);
drop function if exists public.clear_stackacres_session_perks(uuid);
drop function if exists public.forge_stackacres_enchantment(uuid, text, integer, text, integer);
drop function if exists public.harvest_stackacres_crossbreed_plot(uuid, uuid, bigint, uuid, bigint, text, integer);
drop function if exists public.start_stackacres_blueprint(uuid, text);
drop function if exists public.contribute_to_stackacres_blueprint(uuid, text, text, integer);
drop function if exists public.reset_stackacres_prestige(uuid);
-- Only the prestige valve and its progress readout called this.
drop function if exists public.stackacres_lifetime_gross(uuid);
drop function if exists public.pray_at_homestead_shrine(uuid, date, date, integer[]);

-- ---------------------------------------------------------------------------
-- The tables. Children before parents, so no cascade is needed.
-- ---------------------------------------------------------------------------

drop table if exists public.stackacres_session_perks;
drop table if exists public.stackacres_perk_unlocks;
drop table if exists public.stackacres_tool_enchantments;
drop table if exists public.stackacres_crossbreed_plots;
drop table if exists public.stackacres_crossbreed_inventory;
drop table if exists public.stackacres_blueprint_contributions;
drop table if exists public.stackacres_blueprint_progress;
drop table if exists public.stackacres_blueprints;
drop table if exists public.stackacres_blueprint_requirements_def;
drop table if exists public.homestead_prestige_state;
drop table if exists public.homestead_devotion;

-- The prestige reset also wrote its multiplier into the old homestead_inventory
-- table. Nothing reads it.
do $$
begin
  if to_regclass('public.homestead_inventory') is not null then
    delete from public.homestead_inventory where item_id = 'prestige_multiplier_bp';
  end if;
end
$$;

comment on column public.homestead_harvests.payout is
  'A settled line''s nominal value at today''s sell price -- production, not Gold actually paid. A harvest credits inventory now, never Gold directly.';
