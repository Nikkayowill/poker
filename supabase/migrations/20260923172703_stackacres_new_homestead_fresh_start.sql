/* -------------------------------------------------------------------- */
/* The new Homestead: every farm starts its ground over                   */
/* -------------------------------------------------------------------- */

-- The Homestead map was redrawn (art/stackacres-td/areas/rig/homestead.py):
-- a lake to the north, the yard in the middle, wild land all round it. Beds,
-- fences and the Crop Fields' overgrowth are all stored as squares on that
-- map, so on the new one they would stand in the lake or the scrub. Kayo's
-- call was a fresh start rather than moving them.
--
-- What goes: every bed and every crop standing in one, every fence piece,
-- and the Crop Fields' clearing progress (their obstacle ids now name
-- different squares). The six free starter beds are gone too, so a farm
-- opens on bare grass; they were never stored, but the crops on them were,
-- with negative slots. Gold, Wood, Stone, everything in the barn and the
-- Crop Fields milestone are kept.
--
-- Idempotent: running it twice deletes nothing the second time that the
-- first did not.

delete from public.homestead_units
 where soil_slot is not null;

delete from public.homestead_soil_tiles;

delete from public.homestead_fences;

delete from public.homestead_land_obstacles
 where obstacle_id like 'cropfields-%';
