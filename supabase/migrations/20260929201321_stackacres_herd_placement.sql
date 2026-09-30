-- Where a sheep or a cow stands on the Homestead map. The player puts each one
-- down wherever they like, on open grass, instead of the animals living in a
-- fixed district that no longer exists.
--
-- A null position means "not placed yet": every animal that exists today loads
-- that way, and so does a new one until the player sets it down. Hens keep
-- their Hen Haven spots, so their position stays null on purpose.
--
-- The values are Homestead MAP tiles (16 units), the same squares fences use.
-- Placing and picking up move no Gold. The server checks the square against the
-- map, the beds and the fences; the unique index below is what stops two
-- animals landing on one square when two requests race.
alter table public.homestead_units
  add column if not exists map_tx smallint,
  add column if not exists map_ty smallint;

alter table public.homestead_units
  drop constraint if exists homestead_units_map_position_check;
alter table public.homestead_units
  add constraint homestead_units_map_position_check
    check ((map_tx is null) = (map_ty is null));

create unique index if not exists homestead_units_map_position_idx
  on public.homestead_units (profile_id, map_tx, map_ty)
  where map_tx is not null;

comment on column public.homestead_units.map_tx is
  'Homestead map tile column an animal stands on, or null when it has not been placed. See lib/stackacres/herd.ts.';
comment on column public.homestead_units.map_ty is
  'Homestead map tile row an animal stands on, or null when it has not been placed. See lib/stackacres/herd.ts.';
