-- StackAcres: the pond's three catchable fish join the processing inventory
-- item space -- lib/stackacres/fishing.ts, lib/stackacres/machine-items.ts's
-- MACHINE_RAW_ITEMS. A cast at the dock always credits one of them (never
-- Gold directly), the same "harvest fills the shelf" posture the crop/animal
-- item space already carries since 20260910200000_stackacres_gather_craft_sell.
-- Selling one moves through the existing sell_stackacres_item/
-- reserve_homestead_exchange door -- no new SQL needed for that half.

alter table public.homestead_processing_inventory
  drop constraint homestead_processing_inventory_item_check;

alter table public.homestead_processing_inventory
  add constraint homestead_processing_inventory_item_check
  check (item in (
    'wheat', 'flour', 'milk', 'wool', 'cheese', 'cloth', 'cake',
    'eggs',
    'garlic', 'onion', 'beet', 'poppy', 'potato', 'carrot', 'cabbage',
    'cucumber', 'pepper', 'brokoly', 'sunflower', 'sunflowe_broken', 'wheat1', 'tomato',
    'corn', 'corn2', 'eggplant', 'grap', 'grap2', 'pumpkin', 'wheat2', 'artichoke',
    'bluegill', 'trout', 'catfish'
  ));

comment on table public.homestead_processing_inventory is
  'Item quantities for lib/stackacres/machine-items.ts''s MachineItemId -- the whole inventory space, including the pond''s three catchable fish. The only door back to Gold is sell_stackacres_item or a fulfilled homestead_contracts row. Service-role only.';
