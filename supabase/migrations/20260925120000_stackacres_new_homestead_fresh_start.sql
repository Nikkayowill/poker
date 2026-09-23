/* -------------------------------------------------------------------- */
/* The new Homestead: every farm starts its ground over                   */
/* -------------------------------------------------------------------- */

-- The Homestead map was redrawn (art/stackacres-td/areas/rig/homestead.py):
-- a lake to the north, the yard in the middle, wild land all round it. Beds,
-- fences and the Crop Fields' overgrowth are all stored as squares on that
-- map, so on the new one they would stand in the lake or the scrub. Kayo's
-- call was a fresh start rather than moving them.
--
-- What goes: every dug bed and the crop standing on it, every fence piece,
-- and the Crop Fields' clearing progress (their obstacle ids now name
-- different squares). Dug beds number from 0 up; the six free starter beds
-- are never stored and number below 0, so their crops stay and move with
-- them. The Crop Fields milestone, Gold, Wood, Stone and everything in the
-- barn are kept.
--
-- Idempotent: running it twice deletes nothing the second time that the
-- first did not.

delete from public.homestead_units
 where soil_slot is not null
   and soil_slot >= 0;

delete from public.homestead_soil_tiles;

delete from public.homestead_fences;

delete from public.homestead_land_obstacles
 where obstacle_id like 'cropfields-%';
