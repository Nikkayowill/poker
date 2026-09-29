-- The Smelter: an eleventh machine kind that melts Iron Ore into Metal.
-- Iron Ore and Metal are already in homestead_processing_inventory's item
-- list (20260926025010), so only the machine kind, the cap and the recipe id
-- change here. Gold only moves through the existing placement path.

alter table public.homestead_machines
  drop constraint homestead_machines_kind_check;

alter table public.homestead_machines
  add constraint homestead_machines_kind_check
  check (kind in (
    'mill', 'dairy', 'loom', 'vat', 'oven', 'stew_pot', 'counter', 'feed_silo', 'cellar', 'farm_kitchen',
    'smelter'
  ));

-- MACHINE_CAP grew 10 -> 11 with the Smelter (lib/stackacres/machines.ts),
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

  if existing >= 11 then
    raise exception 'StackAcres machine cap reached: % already placed', existing
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.homestead_machines_enforce_cap() is
  'Gates how many machines one player may place at once (11, one of each kind: mill, dairy, loom, vat, oven, stew_pot, counter, feed_silo, cellar, farm_kitchen, smelter). Fires only on insert.';

revoke execute on function public.homestead_machines_enforce_cap() from public, anon, authenticated;

alter table public.homestead_machines
  drop constraint if exists homestead_machines_recipe_id_check;

alter table public.homestead_machines
  add constraint homestead_machines_recipe_id_check
  check (recipe_id is null or recipe_id in (
    'flour', 'cheese', 'cloth', 'cake', 'bread', 'stew', 'salad', 'cattle_feed',
    'sauce', 'salsa', 'stuffed_peppers', 'pickles', 'sauerkraut',
    'bean_casserole', 'harvest_feast', 'metal'
  ));
