/* -------------------------------------------------------------------- */
/* One soil grid for the whole Homestead                                 */
/* -------------------------------------------------------------------- */

-- Beds used to live on two grids. The Crop Fields had one; the two grass
-- paddocks by the house had another, pinned far away (soil tiles 100..122 x
-- 100..105) so the two could never touch, because a bed could only exist in
-- those two places.
--
-- The hoe works on any grass on the Homestead now (lib/stackacres/hoeable.ts),
-- so every bed shares the Crop Fields' grid, which is why no bed dug out there
-- moves. The paddocks' own grid is retired, and any bed dug on it moves to the
-- same square on the shared one: paddock soil tile (100, 100) is Homestead map
-- tile (4, 53), which is soil tile (-18, 35) on the shared grid.
--
-- A crop names its bed by the bed's order (`tile_order`), never by position,
-- so moving a bed takes whatever grows on it along.
--
-- Idempotent: once moved, a bed is outside the old range and not matched
-- again. Safe against the one-bed-per-square rule: the old range and the new
-- one (-18..4 x 35..40) do not overlap, and nothing else is stored there.

update public.homestead_soil_tiles
   set tx = tx - 118,
       ty = ty - 65
 where tx between 100 and 122
   and ty between 100 and 105;
