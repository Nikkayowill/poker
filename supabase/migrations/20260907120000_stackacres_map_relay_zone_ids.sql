-- StackAcres map re-lay: widen every zone/sector CHECK to the nine districts.
--
-- The 2026-09-07 re-lay grows `ZoneId` from four districts to nine. Three
-- columns hardcode the old four-value list, and every one of them would reject
-- a write naming one of the new ids:
--
--   homestead_sectors.sector           (20260904130000_stackacres_sectors_and_upkeep)
--   stackacres_fence_segments.zone     (20260906140000_stackacres_wildlife_defense)
--   stackacres_livestock_health.zone   (20260906140000_stackacres_wildlife_defense)
--
-- WHY THIS ONE IS SAFE TO RUN AGAINST LIVE ROWS, and why it is not the trap
-- `[[reference_stackchips_check_constraints_block_updates]]` records. That
-- note is about TIGHTENING a CHECK: a CHECK re-evaluates on every UPDATE, so
-- narrowing one can strand an existing row that no longer satisfies it, and the
-- Ante Up pass had to reach for a BEFORE INSERT trigger instead. This migration
-- only ever LOOSENS -- the new list is a strict superset of the old one, so
-- every row that satisfies the current constraint satisfies the new one by
-- construction, and no in-flight row can be stranded. Both fence and health
-- rows are UPDATE-heavy (a wave damages a bay, a predator hurts a herd), which
-- is exactly the case that note warns about, and exactly the case a widening
-- cannot break.
--
-- Order matters: drop then add, one statement each, so a failure leaves the
-- column with a constraint rather than none. Named explicitly rather than
-- relying on Postgres's generated `<table>_<column>_check` name, which is only
-- predictable when a column has exactly one unnamed CHECK.
--
-- `henhaven` is the only new id anything writes today. The four reserved
-- districts (`townsquare`, `mine`, `coast`, `oak`) are permanently wild in
-- lib/stackacres/sectors.ts and nothing inserts them, but they are admitted
-- here so that building one later is a code change and not another migration
-- against live tables.

begin;

-- homestead_sectors.sector ---------------------------------------------------
alter table public.homestead_sectors
  drop constraint if exists homestead_sectors_sector_check;

alter table public.homestead_sectors
  add constraint homestead_sectors_sector_check
  check (
    sector in (
      'farmstead', 'henhaven', 'meadow', 'oxfields', 'wallow',
      'townsquare', 'mine', 'coast', 'oak'
    )
  );

-- stackacres_fence_segments.zone ---------------------------------------------
alter table public.stackacres_fence_segments
  drop constraint if exists stackacres_fence_segments_zone_check;

alter table public.stackacres_fence_segments
  add constraint stackacres_fence_segments_zone_check
  check (
    zone in (
      'farmstead', 'henhaven', 'meadow', 'oxfields', 'wallow',
      'townsquare', 'mine', 'coast', 'oak'
    )
  );

-- stackacres_livestock_health.zone -------------------------------------------
alter table public.stackacres_livestock_health
  drop constraint if exists stackacres_livestock_health_zone_check;

alter table public.stackacres_livestock_health
  add constraint stackacres_livestock_health_zone_check
  check (
    zone in (
      'farmstead', 'henhaven', 'meadow', 'oxfields', 'wallow',
      'townsquare', 'mine', 'coast', 'oak'
    )
  );

commit;
