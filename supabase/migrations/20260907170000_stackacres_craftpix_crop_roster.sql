-- Replaces StackAcres' old 2-crop roster (sprout, cash_crop) with the 22
-- CraftPix crops (lib/stackacres/catalogue.ts's STACKACRES_CROPS).
--
-- THREE STEPS, IN THIS ORDER, because a straight narrow-in-one-shot bricks
-- live data and a straight widen-without-migrating leaves it stranded:
--
-- 1. Widen to the UNION of old + new (sprout/cash_crop stay legal alongside
--    the 22 new ids) so the data migration below is not itself rejected by
--    the still-narrow constraint.
-- 2. Migrate existing rows off sprout/cash_crop onto their lossless new-id
--    equivalent. `carrot` and `corn` were deliberately given the exact same
--    seedCost/duration/yield numbers sprout/cash_crop used to have, so this
--    is a pure rename of in-flight rows, not a value change. (6 sprout + 6
--    cash_crop rows in homestead_units, 6 each in homestead_capacity, 0 in
--    stackacres_crossbreed_plots, at time of writing.)
-- 3. Narrow to the final 25-kind roster (22 crops + hen/pig/cattle) now that
--    no row holds sprout/cash_crop any more.
--
-- See reference_stackchips_check_constraints_block_updates on why the order
-- matters at all: narrowing a CHECK past a value live rows still hold bricks
-- every one of those rows' next UPDATE.
--
-- homestead_plots is deliberately NOT touched: it is the dead predecessor
-- table, left in place inert (homestead_units is its successor) -- see
-- homestead_units' own table comment.

alter table public.homestead_units
  drop constraint homestead_units_stock_check,
  add constraint homestead_units_stock_check check (
    stock = any (array[
      'sprout', 'cash_crop',
      'garlic', 'onion', 'beet', 'poppy', 'potato', 'carrot', 'cabbage',
      'cucumber', 'pepper', 'brokoly', 'sunflower', 'sunflowe_broken', 'wheat1', 'tomato',
      'corn', 'corn2', 'eggplant', 'grap', 'grap2', 'pumpkin', 'wheat2', 'artichoke',
      'hen', 'pig', 'cattle'
    ]::text[])
  );

alter table public.homestead_capacity
  drop constraint homestead_capacity_stock_check,
  add constraint homestead_capacity_stock_check check (
    stock = any (array[
      'sprout', 'cash_crop',
      'garlic', 'onion', 'beet', 'poppy', 'potato', 'carrot', 'cabbage',
      'cucumber', 'pepper', 'brokoly', 'sunflower', 'sunflowe_broken', 'wheat1', 'tomato',
      'corn', 'corn2', 'eggplant', 'grap', 'grap2', 'pumpkin', 'wheat2', 'artichoke',
      'hen', 'pig', 'cattle'
    ]::text[])
  );

alter table public.stackacres_crossbreed_plots
  drop constraint stackacres_crossbreed_plots_stock_check,
  add constraint stackacres_crossbreed_plots_stock_check check (
    stock = any (array[
      'sprout', 'cash_crop',
      'garlic', 'onion', 'beet', 'poppy', 'potato', 'carrot', 'cabbage',
      'cucumber', 'pepper', 'brokoly', 'sunflower', 'sunflowe_broken', 'wheat1', 'tomato',
      'corn', 'corn2', 'eggplant', 'grap', 'grap2', 'pumpkin', 'wheat2', 'artichoke',
      'hen', 'pig', 'cattle'
    ]::text[])
  );

update public.homestead_units set stock = 'carrot' where stock = 'sprout';
update public.homestead_units set stock = 'corn' where stock = 'cash_crop';
update public.homestead_capacity set stock = 'carrot' where stock = 'sprout';
update public.homestead_capacity set stock = 'corn' where stock = 'cash_crop';
update public.stackacres_crossbreed_plots set stock = 'carrot' where stock = 'sprout';
update public.stackacres_crossbreed_plots set stock = 'corn' where stock = 'cash_crop';

alter table public.homestead_units
  drop constraint homestead_units_stock_check,
  add constraint homestead_units_stock_check check (
    stock = any (array[
      'garlic', 'onion', 'beet', 'poppy', 'potato', 'carrot', 'cabbage',
      'cucumber', 'pepper', 'brokoly', 'sunflower', 'sunflowe_broken', 'wheat1', 'tomato',
      'corn', 'corn2', 'eggplant', 'grap', 'grap2', 'pumpkin', 'wheat2', 'artichoke',
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
      'hen', 'pig', 'cattle'
    ]::text[])
  );
