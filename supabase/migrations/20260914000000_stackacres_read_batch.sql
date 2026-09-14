-- One round trip in place of the ~30 that stackacres-service.ts's view()
-- fired in parallel (lib/server/stackacres-read-budget.test.ts pins the
-- exact count). Every one of them is a per-profile SELECT with no join --
-- cheap individually (~0.33ms, every table indexed on profile_id), but 30+
-- concurrent PostgREST round trips per tap is 30+ connections pulled from
-- the pool at once, and view() runs on nearly every action, not just a farm
-- load. This function does the identical set of SELECTs server-side, inside
-- one Postgres call, and hands them all back as one JSON object.
--
-- THREE READS ARE DELIBERATELY LEFT OUT, not folded in here:
-- `stackacres_lifetime_gross`, `get_active_stackacres_synergies` and
-- `get_midnight_merchant_state`/`get_midnight_merchant_stock` are already
-- their own RPCs doing real aggregation or idle-session sweep logic
-- server-side, not a plain SELECT -- reimplementing that logic a second
-- time in here to fold them in would be exactly the "duplicate the parsing
-- logic and get it subtly wrong" risk this change is trying to avoid, for
-- three reads out of thirty-plus. They stay their own round trips.
--
-- WHOLE ROWS, not the narrower column lists each individual reader
-- `.select(...)`s -- `to_jsonb(t)`/`jsonb_agg(t)` on the row itself, not a
-- hand-typed column list, so there is no second place these column names
-- can drift from the tables' own definitions. The TypeScript side already
-- only reads the specific fields it wants off whatever object it receives
-- (see each *_FROM_BATCH helper next to its existing reader in
-- lib/server/stackacres-*-store.ts) -- a few extra columns riding along is
-- harmless.
--
-- A scalar subquery returns NULL for zero matching rows, same as
-- `.maybeSingle()`'s "missing row" case, and errors if more than one row
-- matches, same as `.maybeSingle()`'s own over-the-wire behavior (PostgREST
-- enforces singular-response content negotiation) -- neither behavior is
-- new here, both already held for every one of these tables today.
--
-- Item/npc-keyed tables (homestead_secret_ledger, homestead_friendship) are
-- returned as EVERY row for this profile, not filtered to one key -- the
-- original readers each took a specific item id or npc and read one row at
-- a time; the batch instead hands back the whole small set once, and the
-- TypeScript side indexes into it per key. Same for the two blueprint
-- tables: the original `readAllStackAcresBlueprints` looped
-- MYTHIC_BLUEPRINT_IDS, reading two tables per id; this reads both tables
-- once, unfiltered by structure_id, and the loop happens in TypeScript
-- against the batch instead.
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
    'vat_manifest', (select to_jsonb(t) from public.homestead_vat_manifests t where t.profile_id = p_profile_id),
    'cutters', coalesce(
      (select jsonb_agg(t) from public.homestead_cutter t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'story', (select to_jsonb(t) from public.homestead_story t where t.profile_id = p_profile_id),
    'drones', coalesce(
      (select jsonb_agg(t) from public.stackacres_drones t where t.profile_id = p_profile_id),
      '[]'::jsonb
    )
  );
$$;

comment on function public.stackacres_read_batch(uuid, date) is
  'The ~30-table read fan-out stackacres-service.ts''s view() used to fire as separate PostgREST round trips, done here in one call and handed back as one JSON object. Read-only, whole rows. Service-role only.';

-- `public` is load-bearing here, not redundant with anon/authenticated: see
-- reference_stackchips_revoke_execute_from_public -- omitting it has shipped
-- a SECURITY DEFINER function anonymously callable on /rest/v1/rpc twice
-- already. Verify with \df+ / proacl after applying, not by re-reading this
-- file.
revoke all on function public.stackacres_read_batch(uuid, date) from public, anon, authenticated;
