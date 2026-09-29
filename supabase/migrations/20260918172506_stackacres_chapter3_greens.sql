-- StackAcres Chapter 3: greens for the table and the coop.
--
-- Adds the Kitchen Counter (a seventh machine kind, placed in Ray's kitchen),
-- Garden Salad as an inventory item you can eat, and a per-cycle egg bonus
-- on a unit for hens fed Spinach. Gold only moves through existing paths:
-- placing the Counter debits through spend_gold_by_profile like every other
-- machine, and Salad sells through sell_stackacres_item.

/* -------------------------------------------------------------------- */
/* 1. Machines: the Kitchen Counter, and a cap that grows with it        */
/* -------------------------------------------------------------------- */

alter table public.homestead_machines
  drop constraint homestead_machines_kind_check;

alter table public.homestead_machines
  add constraint homestead_machines_kind_check
  check (kind in ('mill', 'dairy', 'loom', 'vat', 'oven', 'stew_pot', 'counter'));

-- MACHINE_CAP grew 6 -> 7 with the Kitchen Counter (lib/stackacres/machines.ts),
-- still one of each kind. Kept in step with that constant by hand.
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

  if existing >= 7 then
    raise exception 'StackAcres machine cap reached: % already placed', existing
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.homestead_machines_enforce_cap() is
  'Gates how many machines one player may place at once (7, one of each kind: mill, dairy, loom, vat, oven, stew_pot, counter). Fires only on insert.';

revoke execute on function public.homestead_machines_enforce_cap() from public, anon, authenticated;

/* -------------------------------------------------------------------- */
/* 2. The item space: Salad                                              */
/* -------------------------------------------------------------------- */

-- Chapter 2's list plus Salad.
alter table public.homestead_processing_inventory
  drop constraint if exists homestead_processing_inventory_item_check;

alter table public.homestead_processing_inventory
  add constraint homestead_processing_inventory_item_check
  check (item in (
    'wheat', 'flour', 'milk', 'wool', 'cheese', 'cloth', 'cake', 'bread', 'stew', 'salad',
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
/* 3. Eating: Salad is food                                              */
/* -------------------------------------------------------------------- */

-- Same function as Chapter 2 with 'salad' in the food list.
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
  if p_item not in ('bread', 'cake', 'stew', 'salad') then
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
  'Eats one Bread, Cake, Stew or Salad: debits it and writes the energy anchor in one transaction. Raises 40001 when the energy row is not at p_expected_version. See eatStackAcresFoodAction in lib/server/stackacres-service.ts.';

revoke all on function public.eat_homestead_food(uuid, text, bigint, integer, timestamptz)
  from public, anon, authenticated;

/* -------------------------------------------------------------------- */
/* 4. The egg bonus: extra produce earned by feeding this cycle          */
/* -------------------------------------------------------------------- */

-- A hen fed Spinach lays one more egg in its current batch. yield_quantity
-- stays the stocking snapshot; this is added on top at collection and goes
-- back to 0 when the unit restarts its cycle. Written only by the feed and
-- collect updates in lib/server/stackacres-store.ts, under their version
-- guard. stackacres_read_batch returns whole rows, so it picks this up
-- without a change.
alter table public.homestead_units
  add column feed_bonus integer not null default 0
  constraint homestead_units_feed_bonus_check check (feed_bonus >= 0);

comment on column public.homestead_units.feed_bonus is
  'Extra produce this cycle earned by feeding (Spinach gives a hen +1 egg). Added to yield_quantity at collection, reset to 0 on restart.';
