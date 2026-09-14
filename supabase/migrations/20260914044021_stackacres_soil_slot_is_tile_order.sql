-- APPLIED 2026-09-14 as version 20260914044021; this file is named to match
-- that version on purpose. THE BACKFILL BELOW IS NOT IDEMPOTENT -- it reads
-- each unit's soil_slot as an INDEX, so running it a second time against
-- already-migrated rows would read a tile_order as an index and scatter every
-- crop onto a different bed. Do not re-run it by hand.

-- A crop's soil_slot becomes its bed's tile_order, instead of that bed's
-- position in the ordered bed list.
--
-- THE BUG THIS FIXES. soilSlotTile in lib/stackacres/soil.ts resolved a slot
-- by indexing orderedSoilTiles, which is a dense array. Deleting one bed made
-- that array shorter, so every crop ordered after the deleted bed slid onto
-- its neighbour's bed and anything past the end wrapped around to the front.
-- Removing a bed in one corner of the farm visibly rearranged crops in the
-- other corner. tile_order is handed out max-plus-one and never reused, so
-- addressing a bed by it means a removal disturbs nothing but the bed removed.
--
-- The backfill maps each unit's stored index through the SAME ordering the
-- code used to read it with -- orderedSoilTiles sorts by tile_order, then ty,
-- then tx -- so every crop lands on the bed it was actually standing on when
-- this ran, not one bed over.
--
-- TWO PASSES, through negative staging values. homestead_units_soil_slot_unique
-- is a plain (non-deferrable) unique index, so it is checked row by row inside
-- an UPDATE; rewriting slots in place is a permutation and a single pass would
-- trip it the moment a row took a value another row still holds. Staging
-- values are -1 - target, which is injective and cannot collide with the
-- non-negative indices the un-migrated rows still hold.

-- Pass 0: everything about to be written, resolved once.
create temporary table soil_slot_backfill as
with bed_rank as (
  select
    profile_id,
    tile_order,
    -- The index soilSlotTile used to use: orderedSoilTiles' sort, zero-based.
    row_number() over (
      partition by profile_id
      order by tile_order, ty, tx
    ) - 1 as bed_index,
    count(*) over (partition by profile_id) as bed_count
  from public.homestead_soil_tiles
),
unit_target as (
  select
    u.id as unit_id,
    b.tile_order,
    -- Two units could resolve to one bed: a stored slot past the bed count
    -- wrapped at read time, so an out-of-range row was already drawn on top
    -- of an in-range one. Keep the lower stored slot -- that is the row that
    -- was standing there before the other wrapped onto it -- and turn the
    -- other loose below.
    row_number() over (partition by u.profile_id, b.tile_order order by u.soil_slot) as rank_on_bed
  from public.homestead_units u
  join bed_rank b
    on b.profile_id = u.profile_id
   and b.bed_index = mod(mod(u.soil_slot, b.bed_count) + b.bed_count, b.bed_count)
  where u.soil_slot is not null
)
select unit_id, tile_order
from unit_target
where rank_on_bed = 1;

-- Pass 1: park every migrating row on a negative value nothing else holds.
update public.homestead_units u
set soil_slot = -1 - b.tile_order
from soil_slot_backfill b
where b.unit_id = u.id;

-- Pass 2: bring them back up to the real tile_order.
update public.homestead_units u
set soil_slot = b.tile_order
from soil_slot_backfill b
where b.unit_id = u.id;

-- Anything that did not resolve to a bed is off the lattice now: a crop whose
-- farm has no beds at all, or the loser of a wrap collision above. Null is
-- what the code already means by that (cropSpot in lib/stackacres/world.ts
-- falls back to the open-field scatter), and leaving a stale index behind
-- would have it address some unrelated bed by its new meaning.
update public.homestead_units u
set soil_slot = null
where u.soil_slot is not null
  and not exists (select 1 from soil_slot_backfill b where b.unit_id = u.id);

comment on column public.homestead_units.soil_slot is
  'The bed this crop stands on, named by that bed''s homestead_soil_tiles.tile_order -- not by its position in any list. Null means the unit is off the bed lattice (livestock, a Greenhouse crop, or a crop whose bed is gone), which lib/stackacres/world.ts''s cropSpot draws with the open-field scatter. Deliberately unconstrained: a value naming no bed resolves to null rather than raising, because a CHECK here would re-evaluate on the UPDATE that settles the row.';

drop table soil_slot_backfill;

-- A new bed's tile_order must also clear every slot a crop is holding.
--
-- Max-plus-one over the bed rows alone was enough while a slot was a list
-- position. It is not enough now that a slot IS a tile_order: lift the newest
-- bed and its order goes back on the shelf, so the next bed bought takes it,
-- and a crop still holding that slot -- remove_homestead_soil_tile's abandon
-- is allowed to lose its race, and says so -- turns up standing on the new
-- bed somewhere else on the farm. homestead_units_soil_slot_unique does not
-- catch that: there is only one crop, it is the bed that moved under it.
-- Mirrors nextSoilOrder's `claimed` argument in lib/stackacres/soil.ts.
create or replace function public.place_homestead_soil_tile(
  p_profile_id uuid,
  p_tx integer,
  p_ty integer,
  p_tier text default 'dirt'
)
returns public.homestead_soil_tiles
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out public.homestead_soil_tiles;
begin
  if exists (
    select 1 from public.homestead_soil_tiles
     where profile_id = p_profile_id and tx = p_tx and ty = p_ty
  ) then
    raise exception using errcode = 'ST003', message = 'soil_tile_occupied';
  end if;

  insert into public.homestead_soil_tiles (profile_id, tx, ty, tile_order, origin, tier)
  select
    p_profile_id,
    p_tx,
    p_ty,
    greatest(
      coalesce((
        select max(tile_order) from public.homestead_soil_tiles
         where profile_id = p_profile_id
      ), -1),
      coalesce((
        select max(soil_slot) from public.homestead_units
         where profile_id = p_profile_id
      ), -1)
    ) + 1,
    'purchased',
    p_tier
  on conflict (profile_id, tx, ty) do nothing
  returning * into row_out;

  -- null here means a concurrent insert won the race for this exact bare
  -- cell between the exists-check above and this insert; the caller treats
  -- that exactly like every other refusal and refunds the bag.
  return row_out;
end;
$$;

-- `public` included explicitly. Omitting it leaves this callable
-- anonymously through PostgREST, which has shipped twice in this codebase
-- before being caught.
revoke execute on function public.place_homestead_soil_tile(uuid, integer, integer, text)
  from public, anon, authenticated;
