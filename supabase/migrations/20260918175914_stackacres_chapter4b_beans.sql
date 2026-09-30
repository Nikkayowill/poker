-- StackAcres Chapter 4b: a bean harvest enriches its bed, and the next crop
-- sown there grows in 75% of the time. No Gold moves.
--
-- stackacres_read_batch returns whole homestead_soil_tiles rows, so it picks
-- the new column up without a change.

alter table public.homestead_soil_tiles
  add column enriched boolean not null default false;
