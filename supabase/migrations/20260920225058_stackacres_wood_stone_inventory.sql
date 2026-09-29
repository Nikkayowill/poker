-- Wood and Stone never reached anyone's inventory. Chopping and mining credit
-- them through adjust_homestead_processing_inventory, but the item check on
-- homestead_processing_inventory did not list them, so every credit was
-- rejected. Add both to the list (the rest of the list is unchanged from
-- 20260919010000).
--
-- Adding them alone would open a worse hole, so the adjust function changes too.
-- A spend of an item the player never held found no row, inserted one at 0 and
-- reported success. Nothing caught that for wood or stone because the check
-- rejected them first. With the check fixed, a new player could build the Mill
-- for Gold alone, and the same path let /sell pay out for goods never held.
-- A spend now needs an existing row with enough on hand, and fails the same way
-- a spend that overdraws an existing row already did (check_violation, which
-- the caller reads as "refused").

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
    'bluegill', 'trout', 'catfish',
    'meat', 'pelt',
    'wood', 'stone'
  ));

create or replace function public.adjust_homestead_processing_inventory(
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
  if p_delta < 0 then
    update public.homestead_processing_inventory
       set quantity = quantity + p_delta,
           updated_at = now()
     where profile_id = p_profile_id
       and item = p_item
       and quantity >= -p_delta
    returning quantity into next_quantity;

    if next_quantity is null then
      raise exception 'not enough % on hand', p_item
        using errcode = 'check_violation';
    end if;

    return next_quantity;
  end if;

  insert into public.homestead_processing_inventory as inv (profile_id, item, quantity)
  values (p_profile_id, p_item, p_delta)
  on conflict (profile_id, item) do update
    set quantity = inv.quantity + p_delta,
        updated_at = now()
  returning inv.quantity into next_quantity;

  return next_quantity;
end;
$$;
