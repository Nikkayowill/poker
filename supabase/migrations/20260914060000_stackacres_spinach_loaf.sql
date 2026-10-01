-- Spinach Loaf: a new Mill recipe that genuinely combines two raw crops
-- (Wheat and Spinach) rather than one, and a Town Contract rung that asks
-- for it -- closing the grow-mill-contract loop end to end, the same shape
-- Cake already proved out for Eggs+Milk+Flour (see 20260910200000's own
-- header on `process_homestead_recipe_multi`, which this reuses unchanged).
--
-- ALSO FIXES A STALE CONSTRAINT found while adding this: the last time
-- homestead_processing_inventory_item_check was written (20260911130000,
-- fishing) still lists the 22 old CraftPix crop ids. The 2026-09-12 crop
-- roster swap (lib/stackacres/catalogue.ts's own header) replaced those with
-- 16 Gr8FarmPack ids outright and never revisited this constraint -- 8 of
-- the 16 (lettuce, spinach, radish, broccoli, bell_pepper, celery,
-- green_bean, wheatsheaf) share no id with the old list, so crediting any of
-- them into this table would currently violate the check. Rewritten here to
-- the FULL current item space (lib/stackacres/machine-items.ts's
-- ALL_MACHINE_ITEM_IDS) plus spinach_loaf, rather than patched with one more
-- name tacked onto a list that was already wrong.

alter table public.homestead_processing_inventory
  drop constraint homestead_processing_inventory_item_check;

alter table public.homestead_processing_inventory
  add constraint homestead_processing_inventory_item_check
  check (item in (
    -- MachineRawItem
    'wheat', 'bluegill', 'trout', 'catfish',
    -- MachineProcessedItem
    'flour', 'cheese', 'cloth', 'cake', 'spinach_loaf',
    -- StackAcresItem: livestock produce
    'eggs', 'wool', 'milk',
    -- StackAcresItem: the 16 current crops (catalogue.ts's STACKACRES_CROPS)
    'lettuce', 'spinach', 'radish', 'carrot',
    'onion', 'potato', 'cabbage', 'green_bean',
    'broccoli', 'pepper', 'bell_pepper', 'celery',
    'tomato', 'corn', 'eggplant', 'wheatsheaf'
  ));

comment on table public.homestead_processing_inventory is
  'Item quantities for lib/stackacres/machine-items.ts''s MachineItemId -- the whole inventory space, since a harvest always credits here instead of paying Gold directly. The only door back to Gold is sell_stackacres_item or a fulfilled homestead_contracts row. Service-role only.';
