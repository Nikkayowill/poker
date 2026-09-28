-- Folds six more small per-profile reads into stackacres_read_batch: wood nodes, land
-- obstacles, forage nodes, the axe, fences, and (now that the map merge added a Far
-- Field and a City) empire buildings and the grocery. view() previously fired these as
-- separate PostgREST round trips alongside the batch RPC on every farm load and every
-- tap; folding them in cuts that back down toward one round trip, the same win the
-- original 20260914000000 migration made for everything else. Below is the body
-- 20260927090000_stackacres_clock.sql installed, plus these seven keys.
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
    'grocery', (select to_jsonb(t) from public.empire_grocery t where t.profile_id = p_profile_id)
  );
$$;

comment on function public.stackacres_read_batch(uuid, date) is
  'The ~37-table read fan-out stackacres-service.ts''s view() used to fire as separate PostgREST round trips, done here in one call and handed back as one JSON object. Read-only, whole rows. Service-role only.';

revoke all on function public.stackacres_read_batch(uuid, date) from public, anon, authenticated;
