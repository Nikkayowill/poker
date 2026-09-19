-- One Wheat. The Wheat Sheaf crop and item (id `wheatsheaf`) are folded into
-- plain `wheat`: the crop is sown on soil beds, and its harvest is the same
-- `wheat` the Mill grinds.
--
-- Same three steps as 20260912120000: widen so the rewrite is not refused,
-- rewrite the rows, then narrow once nothing can violate it.
--
-- Stock of `wheatsheaf` in the inventory is added onto `wheat` one for one.
-- A sheaf sold for 44 and a wheat for 4, so this is a real cut for anyone
-- holding sheaves, accepted because the shop stopped selling them in
-- Chapter 1 and few exist.

/* -------------------------------------------------------------------- */
/* 1. Widen: allow `wheat` beside `wheatsheaf`                           */
/* -------------------------------------------------------------------- */

alter table public.homestead_units
  drop constraint homestead_units_stock_check,
  add constraint homestead_units_stock_check check (
    stock = any (array[
      'onion', 'potato', 'carrot', 'cabbage', 'pepper', 'tomato', 'corn', 'eggplant',
      'bell_pepper', 'broccoli', 'celery', 'green_bean', 'lettuce', 'radish', 'spinach',
      'wheatsheaf', 'wheat',
      'hen', 'pig', 'cattle'
    ]::text[])
  );

alter table public.homestead_capacity
  drop constraint homestead_capacity_stock_check,
  add constraint homestead_capacity_stock_check check (
    stock = any (array[
      'onion', 'potato', 'carrot', 'cabbage', 'pepper', 'tomato', 'corn', 'eggplant',
      'bell_pepper', 'broccoli', 'celery', 'green_bean', 'lettuce', 'radish', 'spinach',
      'wheatsheaf', 'wheat',
      'hen', 'pig', 'cattle'
    ]::text[])
  );

alter table public.stackacres_crossbreed_plots
  drop constraint stackacres_crossbreed_plots_stock_check,
  add constraint stackacres_crossbreed_plots_stock_check check (
    stock = any (array[
      'onion', 'potato', 'carrot', 'cabbage', 'pepper', 'tomato', 'corn', 'eggplant',
      'bell_pepper', 'broccoli', 'celery', 'green_bean', 'lettuce', 'radish', 'spinach',
      'wheatsheaf', 'wheat',
      'hen', 'pig', 'cattle'
    ]::text[])
  );

alter table public.homestead_seed_stock
  drop constraint homestead_seed_stock_crop_check,
  add constraint homestead_seed_stock_crop_check check (
    crop = any (array[
      'onion', 'potato', 'carrot', 'cabbage', 'pepper', 'tomato', 'corn', 'eggplant',
      'bell_pepper', 'broccoli', 'celery', 'green_bean', 'lettuce', 'radish', 'spinach',
      'wheatsheaf', 'wheat'
    ]::text[])
  );

/* -------------------------------------------------------------------- */
/* 2. Rewrite the rows                                                   */
/* -------------------------------------------------------------------- */

update public.homestead_units set stock = 'wheat' where stock = 'wheatsheaf';
update public.homestead_capacity set stock = 'wheat' where stock = 'wheatsheaf';
update public.stackacres_crossbreed_plots set stock = 'wheat' where stock = 'wheatsheaf';
update public.homestead_seed_stock set crop = 'wheat' where crop = 'wheatsheaf';

insert into public.homestead_processing_inventory (profile_id, item, quantity)
  select profile_id, 'wheat', quantity
  from public.homestead_processing_inventory
  where item = 'wheatsheaf' and quantity > 0
on conflict (profile_id, item) do update
  set quantity = public.homestead_processing_inventory.quantity + excluded.quantity,
      updated_at = now();

delete from public.homestead_processing_inventory where item = 'wheatsheaf';

/* -------------------------------------------------------------------- */
/* 3. Narrow: `wheatsheaf` is no longer an id                            */
/* -------------------------------------------------------------------- */

alter table public.homestead_units
  drop constraint homestead_units_stock_check,
  add constraint homestead_units_stock_check check (
    stock = any (array[
      'onion', 'potato', 'carrot', 'cabbage', 'pepper', 'tomato', 'corn', 'eggplant',
      'bell_pepper', 'broccoli', 'celery', 'green_bean', 'lettuce', 'radish', 'spinach', 'wheat',
      'hen', 'pig', 'cattle'
    ]::text[])
  );

alter table public.homestead_capacity
  drop constraint homestead_capacity_stock_check,
  add constraint homestead_capacity_stock_check check (
    stock = any (array[
      'onion', 'potato', 'carrot', 'cabbage', 'pepper', 'tomato', 'corn', 'eggplant',
      'bell_pepper', 'broccoli', 'celery', 'green_bean', 'lettuce', 'radish', 'spinach', 'wheat',
      'hen', 'pig', 'cattle'
    ]::text[])
  );

alter table public.stackacres_crossbreed_plots
  drop constraint stackacres_crossbreed_plots_stock_check,
  add constraint stackacres_crossbreed_plots_stock_check check (
    stock = any (array[
      'onion', 'potato', 'carrot', 'cabbage', 'pepper', 'tomato', 'corn', 'eggplant',
      'bell_pepper', 'broccoli', 'celery', 'green_bean', 'lettuce', 'radish', 'spinach', 'wheat',
      'hen', 'pig', 'cattle'
    ]::text[])
  );

alter table public.homestead_seed_stock
  drop constraint homestead_seed_stock_crop_check,
  add constraint homestead_seed_stock_crop_check check (
    crop = any (array[
      'onion', 'potato', 'carrot', 'cabbage', 'pepper', 'tomato', 'corn', 'eggplant',
      'bell_pepper', 'broccoli', 'celery', 'green_bean', 'lettuce', 'radish', 'spinach', 'wheat'
    ]::text[])
  );

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
    'meat', 'pelt'
  ));
