/* -------------------------------------------------------------------- */
/* Wheat harvest byproducts                                              */
/* -------------------------------------------------------------------- */

-- Wheat remains a crop/stock id for compatibility, but new harvests credit
-- straw. Wheat remains the existing shared crop/grain item so old farms,
-- recipes, contracts and feed rows remain compatible.
alter table public.homestead_processing_inventory
  drop constraint if exists homestead_processing_inventory_item_check;

alter table public.homestead_processing_inventory
  add constraint homestead_processing_inventory_item_check
  check (item in (
    'wheat', 'straw', 'flour', 'milk', 'wool', 'cheese', 'cloth', 'cake', 'bread', 'stew', 'salad',
    'cattle_feed', 'sauce', 'salsa', 'stuffed_peppers', 'pickles', 'sauerkraut',
    'bean_casserole', 'harvest_feast', 'eggs',
    'garlic', 'onion', 'beet', 'poppy', 'potato', 'carrot', 'cabbage',
    'cucumber', 'pepper', 'brokoly', 'sunflower', 'sunflowe_broken', 'wheat1', 'tomato',
    'corn', 'corn2', 'eggplant', 'grap', 'grap2', 'pumpkin', 'wheat2', 'artichoke',
    'lettuce', 'spinach', 'radish', 'broccoli', 'bell_pepper', 'celery', 'green_bean',
    'bluegill', 'trout', 'catfish', 'meat', 'pelt', 'wood', 'stone', 'iron_ore', 'metal'
  ));
