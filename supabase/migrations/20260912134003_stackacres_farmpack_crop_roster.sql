-- Replaces StackAcres' 22-crop CraftPix roster with the 16-crop Gr8FarmPack
-- roster (lib/stackacres/catalogue.ts's STACKACRES_CROPS, 2026-09-12) -- a
-- full rip-and-replace, not an extension, mirroring 20260907170000's own
-- sprout/cash_crop -> 22-crop swap.
--
-- Eight ids carry straight over unchanged (same id, new art, possibly a new
-- tier): carrot, onion, cabbage, potato, pepper, tomato, corn, eggplant.
-- Fourteen ids have no successor at all -- garlic, beet, poppy, cucumber,
-- brokoly, sunflower, sunflowe_broken, wheat1, wheat2, corn2, grap, grap2,
-- pumpkin, artichoke -- there is no lossless rename the way sprout->carrot
-- was, so any live row still holding one of these is deleted rather than
-- guessed at. This is the same "start like we just found some" reset the
-- app code took; a stocked plot of a retired crop is gone, not migrated.
--
-- THREE STEPS, IN THIS ORDER, same reasoning 20260907170000 states: widen
-- first so the delete below is not itself rejected by a still-narrow
-- constraint, then narrow only once no row can violate it.

alter table public.homestead_units
  drop constraint homestead_units_stock_check,
  add constraint homestead_units_stock_check check (
    stock = any (array[
      'garlic', 'onion', 'beet', 'poppy', 'potato', 'carrot', 'cabbage',
      'cucumber', 'pepper', 'brokoly', 'sunflower', 'sunflowe_broken', 'wheat1', 'tomato',
      'corn', 'corn2', 'eggplant', 'grap', 'grap2', 'pumpkin', 'wheat2', 'artichoke',
      'bell_pepper', 'broccoli', 'celery', 'green_bean', 'lettuce', 'radish', 'spinach', 'wheatsheaf',
      'hen', 'pig', 'cattle'
    ]::text[])
  );

alter table public.homestead_capacity
  drop constraint homestead_capacity_stock_check,
  add constraint homestead_capacity_stock_check check (
    stock = any (array[
      'garlic', 'onion', 'beet', 'poppy', 'potato', 'carrot', 'cabbage',
      'cucumber', 'pepper', 'brokoly', 'sunflower', 'sunflowe_broken', 'wheat1', 'tomato',
      'corn', 'corn2', 'eggplant', 'grap', 'grap2', 'pumpkin', 'wheat2', 'artichoke',
      'bell_pepper', 'broccoli', 'celery', 'green_bean', 'lettuce', 'radish', 'spinach', 'wheatsheaf',
      'hen', 'pig', 'cattle'
    ]::text[])
  );

alter table public.stackacres_crossbreed_plots
  drop constraint stackacres_crossbreed_plots_stock_check,
  add constraint stackacres_crossbreed_plots_stock_check check (
    stock = any (array[
      'garlic', 'onion', 'beet', 'poppy', 'potato', 'carrot', 'cabbage',
      'cucumber', 'pepper', 'brokoly', 'sunflower', 'sunflowe_broken', 'wheat1', 'tomato',
      'corn', 'corn2', 'eggplant', 'grap', 'grap2', 'pumpkin', 'wheat2', 'artichoke',
      'bell_pepper', 'broccoli', 'celery', 'green_bean', 'lettuce', 'radish', 'spinach', 'wheatsheaf',
      'hen', 'pig', 'cattle'
    ]::text[])
  );

alter table public.homestead_seed_stock
  drop constraint homestead_seed_stock_crop_check,
  add constraint homestead_seed_stock_crop_check check (
    crop = any (array[
      'garlic', 'onion', 'beet', 'poppy', 'potato', 'carrot', 'cabbage',
      'cucumber', 'pepper', 'brokoly', 'sunflower', 'sunflowe_broken', 'wheat1', 'tomato',
      'corn', 'corn2', 'eggplant', 'grap', 'grap2', 'pumpkin', 'wheat2', 'artichoke',
      'bell_pepper', 'broccoli', 'celery', 'green_bean', 'lettuce', 'radish', 'spinach', 'wheatsheaf'
    ]::text[])
  );

-- Retired ids with no successor: delete rather than guess a mapping. See
-- this file's header for the full list and why.
delete from public.homestead_units
  where stock in ('garlic', 'beet', 'poppy', 'cucumber', 'brokoly', 'sunflower',
                  'sunflowe_broken', 'wheat1', 'wheat2', 'corn2', 'grap', 'grap2',
                  'pumpkin', 'artichoke');
delete from public.homestead_capacity
  where stock in ('garlic', 'beet', 'poppy', 'cucumber', 'brokoly', 'sunflower',
                  'sunflowe_broken', 'wheat1', 'wheat2', 'corn2', 'grap', 'grap2',
                  'pumpkin', 'artichoke');
delete from public.stackacres_crossbreed_plots
  where stock in ('garlic', 'beet', 'poppy', 'cucumber', 'brokoly', 'sunflower',
                  'sunflowe_broken', 'wheat1', 'wheat2', 'corn2', 'grap', 'grap2',
                  'pumpkin', 'artichoke');
delete from public.homestead_seed_stock
  where crop in ('garlic', 'beet', 'poppy', 'cucumber', 'brokoly', 'sunflower',
                 'sunflowe_broken', 'wheat1', 'wheat2', 'corn2', 'grap', 'grap2',
                 'pumpkin', 'artichoke');

alter table public.homestead_units
  drop constraint homestead_units_stock_check,
  add constraint homestead_units_stock_check check (
    stock = any (array[
      'onion', 'potato', 'carrot', 'cabbage', 'pepper', 'tomato', 'corn', 'eggplant',
      'bell_pepper', 'broccoli', 'celery', 'green_bean', 'lettuce', 'radish', 'spinach', 'wheatsheaf',
      'hen', 'pig', 'cattle'
    ]::text[])
  );

alter table public.homestead_capacity
  drop constraint homestead_capacity_stock_check,
  add constraint homestead_capacity_stock_check check (
    stock = any (array[
      'onion', 'potato', 'carrot', 'cabbage', 'pepper', 'tomato', 'corn', 'eggplant',
      'bell_pepper', 'broccoli', 'celery', 'green_bean', 'lettuce', 'radish', 'spinach', 'wheatsheaf',
      'hen', 'pig', 'cattle'
    ]::text[])
  );

alter table public.stackacres_crossbreed_plots
  drop constraint stackacres_crossbreed_plots_stock_check,
  add constraint stackacres_crossbreed_plots_stock_check check (
    stock = any (array[
      'onion', 'potato', 'carrot', 'cabbage', 'pepper', 'tomato', 'corn', 'eggplant',
      'bell_pepper', 'broccoli', 'celery', 'green_bean', 'lettuce', 'radish', 'spinach', 'wheatsheaf',
      'hen', 'pig', 'cattle'
    ]::text[])
  );

alter table public.homestead_seed_stock
  drop constraint homestead_seed_stock_crop_check,
  add constraint homestead_seed_stock_crop_check check (
    crop = any (array[
      'onion', 'potato', 'carrot', 'cabbage', 'pepper', 'tomato', 'corn', 'eggplant',
      'bell_pepper', 'broccoli', 'celery', 'green_bean', 'lettuce', 'radish', 'spinach', 'wheatsheaf'
    ]::text[])
  );
