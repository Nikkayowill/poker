-- StackAcres Chapter 1: the bread basket.
--
-- Adds the Oven (a fifth machine kind, placed in Ray's kitchen), Bread as an
-- inventory item, and per-farm energy. Gold only moves through existing
-- paths: placing the Oven debits through spend_gold_by_profile like every
-- other machine, and Bread sells through sell_stackacres_item. Nothing here
-- moves Gold.

/* -------------------------------------------------------------------- */
/* 1. Machines: the Oven, and a cap that grows with it                   */
/* -------------------------------------------------------------------- */

alter table public.homestead_machines
  drop constraint homestead_machines_kind_check;

alter table public.homestead_machines
  add constraint homestead_machines_kind_check
  check (kind in ('mill', 'dairy', 'loom', 'vat', 'oven'));

-- MACHINE_CAP grew 4 -> 5 with the Oven (lib/stackacres/machines.ts), the
-- same "one of each kind" rule as before. Kept in step with that constant by
-- hand.
create or replace function public.homestead_machines_enforce_cap()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  existing integer;
begin
  perform pg_advisory_xact_lock(hashtext(new.profile_id::text || ':machines'));

  select count(*) into existing
  from public.homestead_machines
  where profile_id = new.profile_id;

  if existing >= 5 then
    raise exception 'StackAcres machine cap reached: % already placed', existing
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.homestead_machines_enforce_cap() is
  'Gates how many machines one player may place at once (5, one of each kind: mill, dairy, loom, vat, oven). Fires only on insert.';

revoke execute on function public.homestead_machines_enforce_cap() from public, anon, authenticated;

/* -------------------------------------------------------------------- */
/* 2. The item space: Bread                                              */
/* -------------------------------------------------------------------- */

-- The last widening (20260911130000) predates the 16-crop Gr8FarmPack
-- roster and the Oak's meat/pelt, so this list is every id any earlier
-- check allowed plus every id the app writes today (lib/stackacres/
-- machine-items.ts's ALL_MACHINE_ITEM_IDS), plus Bread. A superset, so no
-- existing row can fail it.
alter table public.homestead_processing_inventory
  drop constraint if exists homestead_processing_inventory_item_check;

alter table public.homestead_processing_inventory
  add constraint homestead_processing_inventory_item_check
  check (item in (
    'wheat', 'flour', 'milk', 'wool', 'cheese', 'cloth', 'cake', 'bread',
    'eggs',
    'garlic', 'onion', 'beet', 'poppy', 'potato', 'carrot', 'cabbage',
    'cucumber', 'pepper', 'brokoly', 'sunflower', 'sunflowe_broken', 'wheat1', 'tomato',
    'corn', 'corn2', 'eggplant', 'grap', 'grap2', 'pumpkin', 'wheat2', 'artichoke',
    'lettuce', 'spinach', 'radish', 'broccoli', 'bell_pepper', 'celery', 'green_bean',
    'wheatsheaf',
    'bluegill', 'trout', 'catfish',
    'meat', 'pelt'
  ));

/* -------------------------------------------------------------------- */
/* 3. Energy                                                             */
/* -------------------------------------------------------------------- */

-- One row per farm: the level and the instant it was that level. The current
-- value is computed on read in lib/stackacres/energy.ts (regen 1 point per 6
-- minutes up to 50), so nothing here ticks. No row means a full farm (100).
-- Writes are version-guarded compare-and-set from the service.
create table public.homestead_energy (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  level integer not null check (level >= 0 and level <= 100),
  updated_at timestamptz not null,
  version bigint not null default 1 check (version > 0)
);

comment on table public.homestead_energy is
  'A farm''s energy anchor: level as of updated_at. Regen is derived on read in lib/stackacres/energy.ts. No row means full. Service-role only.';

alter table public.homestead_energy enable row level security;
revoke all on public.homestead_energy from anon, authenticated;

-- Eating: one food item leaves inventory and the new energy anchor lands in
-- the same transaction. The service computes the new anchor from the row it
-- read at p_expected_version (0 = no row yet). If the energy row moved in
-- between, this raises 40001 and the food debit rolls back with it; the
-- service re-reads and tries again. Returns 'eaten', or 'no-food' when there
-- was nothing to eat (and nothing was written).
create or replace function public.eat_homestead_food(
  p_profile_id uuid,
  p_item text,
  p_expected_version bigint,
  p_level integer,
  p_updated_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left integer;
  v_rows integer;
begin
  if p_item not in ('bread', 'cake') then
    raise exception 'eat_homestead_food: % is not food', p_item using errcode = '22023';
  end if;

  update public.homestead_processing_inventory
     set quantity = quantity - 1,
         updated_at = now()
   where profile_id = p_profile_id
     and item = p_item
     and quantity >= 1
  returning quantity into v_left;

  if v_left is null then
    return 'no-food';
  end if;

  if p_expected_version = 0 then
    insert into public.homestead_energy (profile_id, level, updated_at, version)
    values (p_profile_id, p_level, p_updated_at, 1)
    on conflict (profile_id) do nothing;
  else
    update public.homestead_energy
       set level = p_level,
           updated_at = p_updated_at,
           version = version + 1
     where profile_id = p_profile_id
       and version = p_expected_version;
  end if;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'eat_homestead_food: energy moved on' using errcode = '40001';
  end if;

  return 'eaten';
end;
$$;

comment on function public.eat_homestead_food(uuid, text, bigint, integer, timestamptz) is
  'Eats one Bread or Cake: debits it and writes the energy anchor in one transaction. Raises 40001 when the energy row is not at p_expected_version. See eatStackAcresFoodAction in lib/server/stackacres-service.ts.';

revoke all on function public.eat_homestead_food(uuid, text, bigint, integer, timestamptz)
  from public, anon, authenticated;

/* -------------------------------------------------------------------- */
/* 4. The read batch gains an `energy` key                               */
/* -------------------------------------------------------------------- */

-- Same function as 20260914000000_stackacres_read_batch.sql with one more
-- key at the end.
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
    ),
    'energy', (select to_jsonb(t) from public.homestead_energy t where t.profile_id = p_profile_id)
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
