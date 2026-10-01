-- The guard dog (lib/stackacres/guard-dog.ts): one row per dog, standing on a
-- Homestead map square. A dog is bought once with Gold by the service, which
-- debits before the row exists and refunds if the insert is refused; moving a
-- dog moves no Gold. Where a dog may stand (open yard grass, not a bed, a fence
-- or an animal) is application code's call; the unique index below is what
-- stops two dogs landing on one square when two requests race, and the cap is
-- held under a lock in add_homestead_guard_dog so two buys cannot both pass it.
create table if not exists public.homestead_guard_dogs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tx smallint not null check (tx >= 0),
  ty smallint not null check (ty >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists homestead_guard_dogs_square_idx
  on public.homestead_guard_dogs (profile_id, tx, ty);
create index if not exists homestead_guard_dogs_profile_idx
  on public.homestead_guard_dogs (profile_id);

comment on table public.homestead_guard_dogs is
  'Guard dogs a profile keeps on its Homestead, by map square. Bought once with Gold by the service (debit first, refund on a refused insert); moved for free. Service-role only. See lib/stackacres/guard-dog.ts.';

alter table public.homestead_guard_dogs enable row level security;
revoke all on public.homestead_guard_dogs from public, anon, authenticated;

-- Adds a dog at (p_tx, p_ty), already paid for by the caller. One farm's
-- additions are serialised so the cap holds under two taps at once.
-- Returns the new dog's id, or why not: 'taken' (something of this player's
-- already stands there) or 'full' (at the cap). The caller refunds on either.
create or replace function public.add_homestead_guard_dog(
  p_profile_id uuid,
  p_tx integer,
  p_ty integer,
  p_cap integer
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('homestead_guard_dogs:' || p_profile_id::text));

  if (select count(*) from public.homestead_guard_dogs where profile_id = p_profile_id) >= p_cap then
    return 'full';
  end if;

  begin
    insert into public.homestead_guard_dogs (profile_id, tx, ty)
    values (p_profile_id, p_tx, p_ty)
    returning id into v_id;
  exception when unique_violation then
    return 'taken';
  end;

  return v_id::text;
end;
$$;

revoke all on function public.add_homestead_guard_dog(uuid, integer, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- stackacres_read_batch, plus the dogs.
--
-- Below is the body 20261001180411_stackacres_farm_board.sql installed, with
-- 'guard_dogs' added, so view() reads the dogs in the same round trip as the
-- rest of the farm (lib/server/stackacres-read-budget.test.ts).
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
    -- The guard dogs on this player's Homestead (lib/stackacres/guard-dog.ts).
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
