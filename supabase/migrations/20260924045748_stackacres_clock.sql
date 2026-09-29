-- The farm clock (lib/stackacres/clock.ts). A game day lasts 13 real minutes
-- and every farm shares world time, (now + offset_ms) mod one day. Sleeping
-- in the farmhouse bed is the only thing that moves offset_ms: it jumps
-- forward to the next 6 AM. Nothing economic reads it. Crop, animal and
-- machine timers, energy, the UTC-day limits and Gold all ignore it.
--
-- No row means offset 0. The service writes with a compare-and-set on the
-- old offset_ms, which only ever grows, so two sleeps racing cannot both
-- land.

create table public.homestead_clock (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  offset_ms bigint not null default 0,
  slept_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.homestead_clock is
  'A farm''s clock offset: game time is (now + offset_ms) mod 13 minutes, see lib/stackacres/clock.ts. Only sleeping moves it. No row means 0. Service-role only.';

alter table public.homestead_clock enable row level security;
revoke all on public.homestead_clock from anon, authenticated;

-- The batch read gains a 'clock' key. Below is the body
-- 20260921220000_stackacres_read_batch_without_drones.sql installed, plus
-- that one key.
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
    )
  );
$$;

comment on function public.stackacres_read_batch(uuid, date) is
  'The ~30-table read fan-out stackacres-service.ts''s view() used to fire as separate PostgREST round trips, done here in one call and handed back as one JSON object. Read-only, whole rows. Service-role only.';

revoke all on function public.stackacres_read_batch(uuid, date) from public, anon, authenticated;

