-- Two crops sown at nearly the same moment could both land on the same
-- soil_slot: `assignSoilSlot` (lib/server/stackacres-service.ts) reads every
-- unit's slot and picks the lowest free one, then the insert happens after,
-- with nothing in between to stop a second sow reading the same "taken" set
-- before the first insert lands. The result was two crops rendered on top of
-- each other on the same bed square.
--
-- This is the same class of race `homestead_soil_tiles` already closed with
-- `unique (profile_id, tx, ty)` -- see 20260907180000_stackacres_soil_per_square.sql,
-- whose `place_homestead_soil_tile` RPC relies on exactly this kind of
-- constraint plus `on conflict` to turn the race into a clean "raced" outcome
-- instead of a silent duplicate. `soil_slot` gets a matching partial unique
-- index here; the application-side retry lives in
-- lib/server/stackacres-store.ts (`createStackAcresUnit`, mapping Postgres
-- 23505 to `SoilSlotConflictError`) and lib/server/stackacres-service.ts
-- (`stockStackAcres`, re-picking a slot and retrying a couple of times before
-- falling back to a null slot).
--
-- PARTIAL, on `soil_slot is not null`. Livestock and Greenhouse crops are
-- always written with a null slot (see `assignSoilSlot`'s early returns) and
-- there is no reason two of those should ever be forced apart -- a plain
-- unique constraint would wrongly reject the second null-slot unit a player
-- ever stocks.
create unique index if not exists homestead_units_soil_slot_unique
  on public.homestead_units(profile_id, soil_slot)
  where soil_slot is not null;
