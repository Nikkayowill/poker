-- Town Contracts become a board of up to four open orders per farm, each with
-- one or two requirement lines, any of which can be delivered, one of which
-- can be pinned. See lib/stackacres/contracts.ts's header for the rules.
--
-- WHAT CHANGES HERE
--   * The one-open-per-profile unique index goes. The cap is now four, kept
--     by a BEFORE INSERT trigger under a per-profile advisory lock, so two
--     tabs posting at once still end at four and not five.
--   * `requirements` (jsonb) carries the lines. `item`/`quantity` stay as the
--     first line, backfilled for every existing row, so history reads the
--     same and nothing has to be dropped. The item CHECK goes: an order can
--     now ask for a crop, a fish or a hybrid, and the list of valid items is
--     the code's (lib/stackacres/contracts.ts's `isContractItem`).
--   * `pinned`, with a partial unique index so at most one open order per
--     farm is pinned however many tabs race.
--   * `pin_homestead_contract` moves the pin in one statement.
--   * `adjust_stackacres_crossbreed_inventory` is the hybrids' twin of
--     `adjust_homestead_processing_inventory`: a delivery is the first thing
--     that ever debits a hybrid.
--   * `stackacres_read_batch` returns `contracts` (an array) instead of
--     `contract` (one object). Code deployed before this reads `contract`,
--     finds nothing, and shows an empty board until it redeploys.
--
-- Nothing here is a CHECK that tightens on existing rows (the 2026-08 trap):
-- the only new CHECK is on `requirements`, which the backfill below makes
-- true of every row first, and the cap is a trigger, not a constraint.

drop index if exists public.homestead_contracts_one_open_per_profile;

alter table public.homestead_contracts
  drop constraint if exists homestead_contracts_item_check;

alter table public.homestead_contracts
  add column if not exists title text not null default '',
  add column if not exists requirements jsonb not null default '[]'::jsonb,
  add column if not exists pinned boolean not null default false;

update public.homestead_contracts
  set requirements = jsonb_build_array(jsonb_build_object('item', item, 'quantity', quantity))
  where requirements = '[]'::jsonb;

alter table public.homestead_contracts
  add constraint homestead_contracts_requirements_check
  check (jsonb_typeof(requirements) = 'array' and jsonb_array_length(requirements) between 1 and 2);

comment on column public.homestead_contracts.requirements is
  'The order''s lines, [{item, quantity}], one or two. item/quantity beside it are the first line, kept for history. Items are validated by lib/stackacres/contracts.ts, not here.';

comment on column public.homestead_contracts.pinned is
  'The one open order the farm HUD keeps in view. At most one per profile while open (partial unique index below).';

create unique index if not exists homestead_contracts_one_pinned_per_profile
  on public.homestead_contracts (profile_id)
  where status = 'open' and pinned;

-- Four open orders a farm, held under a per-profile advisory lock so a race
-- between two inserts serialises instead of both counting three and both
-- landing. Raises check_violation, which the store treats like a lost race.
create or replace function public.homestead_contracts_cap_open()
returns trigger
language plpgsql
as $$
declare
  open_count integer;
begin
  if new.status <> 'open' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('homestead_contracts:' || new.profile_id::text));
  select count(*) into open_count
    from public.homestead_contracts
    where profile_id = new.profile_id and status = 'open';
  if open_count >= 4 then
    raise exception 'The town board is full' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.homestead_contracts_cap_open() from public, anon, authenticated;

drop trigger if exists homestead_contracts_cap_open on public.homestead_contracts;
create trigger homestead_contracts_cap_open
  before insert on public.homestead_contracts
  for each row execute function public.homestead_contracts_cap_open();

-- Moves the pin to one open order (or clears it with a null id) in a single
-- statement, so two tabs pinning different orders cannot leave two pinned.
-- Returns true when the target was an open order of this profile.
create or replace function public.pin_homestead_contract(
  p_profile_id uuid,
  p_contract_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  found_target boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext('homestead_contracts:' || p_profile_id::text));
  update public.homestead_contracts
    set pinned = false
    where profile_id = p_profile_id and status = 'open' and pinned;
  if p_contract_id is null then
    return true;
  end if;
  update public.homestead_contracts
    set pinned = true
    where id = p_contract_id and profile_id = p_profile_id and status = 'open';
  found_target := found;
  return found_target;
end;
$$;

comment on function public.pin_homestead_contract(uuid, uuid) is
  'Moves this profile''s one pin to the given open order, or clears it for null. Service-role only.';

revoke all on function public.pin_homestead_contract(uuid, uuid) from public, anon, authenticated;

-- The hybrids' twin of adjust_homestead_processing_inventory: one row lock,
-- never a read-then-write, and the quantity check refuses to go negative.
create or replace function public.adjust_stackacres_crossbreed_inventory(
  p_profile_id uuid,
  p_item text,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_quantity integer;
begin
  insert into public.stackacres_crossbreed_inventory as inv (profile_id, item, quantity)
  values (p_profile_id, p_item, greatest(p_delta, 0))
  on conflict (profile_id, item) do update
    set quantity = inv.quantity + p_delta,
        updated_at = now()
  returning inv.quantity into next_quantity;

  return next_quantity;
end;
$$;

comment on function public.adjust_stackacres_crossbreed_inventory(uuid, text, integer) is
  'Moves one player''s quantity of one hybrid atomically. Raises 23514 rather than going negative; the store treats that as a refusal. Service-role only.';

revoke all on function public.adjust_stackacres_crossbreed_inventory(uuid, text, integer) from public, anon, authenticated;

comment on table public.homestead_contracts is
  'The town order board: up to four open orders per farm, each one or two requirement lines, any deliverable, one pinnable. Gold paid on delivery through fulfillStackAcresTownContract in lib/server/stackacres-service.ts. Service-role only.';

-- The batch read now carries the whole board. Body below is what
-- 20260928232207_stackacres_read_batch_fold_far_field.sql installed, with the
-- one 'contract' key replaced by 'contracts'.
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
    -- The whole open board, oldest first. Was a single 'contract' object when
    -- the board had one slot; see 20260930160000_stackacres_contract_board.sql.
    'contracts', coalesce(
      (select jsonb_agg(t order by t.created_at) from public.homestead_contracts t
       where t.profile_id = p_profile_id and t.status = 'open'),
      '[]'::jsonb
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
  'Batched per-profile farm read for view() in stackacres-service.ts. Read-only. Service-role only.';

revoke all on function public.stackacres_read_batch(uuid, date) from public, anon, authenticated;
