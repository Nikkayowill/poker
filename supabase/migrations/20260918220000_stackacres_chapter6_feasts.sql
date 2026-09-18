-- StackAcres Chapter 6: feasts.
--
-- Adds Bean Casserole and the Harvest Feast (both food, both giftable), town
-- orders for the casserole, and the Farm Kitchen: a tenth machine kind that
-- cooks one standing order while the player is away. Its order and the
-- instant its batches bank from live on its own machine row. Gold only moves
-- through existing paths: placing it debits through spend_gold_by_profile,
-- and what it cooks is inventory, sold or delivered like anything else.

/* -------------------------------------------------------------------- */
/* 1. Machines: the Farm Kitchen, and a cap that grows with it           */
/* -------------------------------------------------------------------- */

alter table public.homestead_machines
  drop constraint homestead_machines_kind_check;

alter table public.homestead_machines
  add constraint homestead_machines_kind_check
  check (kind in (
    'mill', 'dairy', 'loom', 'vat', 'oven', 'stew_pot', 'counter', 'feed_silo', 'cellar', 'farm_kitchen'
  ));

-- MACHINE_CAP grew 9 -> 10 with the Farm Kitchen (lib/stackacres/machines.ts),
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

  if existing >= 10 then
    raise exception 'StackAcres machine cap reached: % already placed', existing
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.homestead_machines_enforce_cap() is
  'Gates how many machines one player may place at once (10, one of each kind: mill, dairy, loom, vat, oven, stew_pot, counter, feed_silo, cellar, farm_kitchen). Fires only on insert.';

revoke execute on function public.homestead_machines_enforce_cap() from public, anon, authenticated;

alter table public.homestead_machines
  drop constraint if exists homestead_machines_recipe_id_check;

alter table public.homestead_machines
  add constraint homestead_machines_recipe_id_check
  check (recipe_id is null or recipe_id in (
    'flour', 'cheese', 'cloth', 'cake', 'bread', 'stew', 'salad', 'cattle_feed',
    'sauce', 'salsa', 'stuffed_peppers', 'pickles', 'sauerkraut',
    'bean_casserole', 'harvest_feast'
  ));

/* -------------------------------------------------------------------- */
/* 2. The Farm Kitchen's standing order                                  */
/* -------------------------------------------------------------------- */

-- Written only by writeStackAcresFarmKitchen in lib/server/stackacres-store.ts,
-- under the row's version guard. The recipe list is every kitchen recipe
-- (FARM_KITCHEN_RECIPES in lib/stackacres/farm-kitchen.ts), kept by hand.
alter table public.homestead_machines
  add column standing_recipe text
    constraint homestead_machines_standing_recipe_check check (standing_recipe is null or standing_recipe in (
      'bread', 'stew', 'salad', 'sauce', 'salsa', 'stuffed_peppers', 'pickles', 'sauerkraut',
      'bean_casserole', 'harvest_feast'
    )),
  add column kitchen_since timestamptz;

comment on column public.homestead_machines.standing_recipe is
  'Farm Kitchen only: the recipe it cooks while the player is away. Null until set.';
comment on column public.homestead_machines.kitchen_since is
  'Farm Kitchen only: the instant its batches bank from, one per 30 minutes, at most 16. Moves forward as batches are cooked.';

/* -------------------------------------------------------------------- */
/* 3. The item space: the two feasts                                     */
/* -------------------------------------------------------------------- */

-- Chapter 5's list plus the two feasts.
alter table public.homestead_processing_inventory
  drop constraint if exists homestead_processing_inventory_item_check;

alter table public.homestead_processing_inventory
  add constraint homestead_processing_inventory_item_check
  check (item in (
    'wheat', 'flour', 'milk', 'wool', 'cheese', 'cloth', 'cake', 'bread', 'stew', 'salad',
    'cattle_feed', 'sauce', 'salsa', 'stuffed_peppers', 'pickles', 'sauerkraut',
    'bean_casserole', 'harvest_feast',
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
/* 4. Town orders for Bean Casserole                                     */
/* -------------------------------------------------------------------- */

alter table public.homestead_contracts
  drop constraint homestead_contracts_item_check;

alter table public.homestead_contracts
  add constraint homestead_contracts_item_check
  check (item in ('flour', 'cheese', 'cloth', 'sauce', 'salsa', 'pickles', 'bean_casserole'));

/* -------------------------------------------------------------------- */
/* 5. Eating: both feasts are food                                       */
/* -------------------------------------------------------------------- */

-- Same function as Chapter 5 with two more foods.
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
  if p_item not in ('bread', 'cake', 'stew', 'salad', 'salsa', 'stuffed_peppers', 'bean_casserole', 'harvest_feast') then
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
  'Eats one Bread, Cake, Stew, Salad, Salsa, Stuffed Peppers, Bean Casserole or Harvest Feast: debits it and writes the energy anchor in one transaction. Raises 40001 when the energy row is not at p_expected_version. See eatStackAcresFoodAction in lib/server/stackacres-service.ts.';

revoke all on function public.eat_homestead_food(uuid, text, bigint, integer, timestamptz)
  from public, anon, authenticated;
