-- The Mechanical Forage Drone and the predator-defense fences are gone from
-- the game. Both were built for the isometric farm and did nothing in the
-- top-down one: no drone hangar or forage drop is drawn, and no fence line or
-- predator exists to defend against. All four tables were empty in production
-- when this was written.
--
-- ORDER MATTERS, and it is the opposite of the usual one: the code that reads
-- these tables ships first, then this runs. Applying it ahead of the deploy
-- would make a live farm read throw.
--
-- IRRIGATION IS ONLY HALF REMOVED ON PURPOSE. Nothing can place a pipe any
-- more (the tool, the route actions and the three placement functions are
-- gone), but `homestead_pipes` and `sync_homestead_pipe_network` stay: the
-- same recompute that reads them is what waters a crop sitting on a hydro
-- soil bed, so dropping them would take live watering with it. The table is
-- empty and can only stay that way.

drop function if exists public.collect_stackacres_drone_forage(uuid, uuid, integer, integer, integer);
drop function if exists public.deploy_stackacres_drone(uuid, integer);
drop table if exists public.stackacres_drones;

drop function if exists public.save_stackacres_predator_wave(uuid, bigint, boolean, jsonb);
drop function if exists public.upsert_stackacres_fence_segment(uuid, text, integer, bigint, text, integer);
drop table if exists public.stackacres_predator_waves;
drop table if exists public.stackacres_livestock_health;
drop table if exists public.stackacres_fence_segments;

-- Placement only. The sync/list path above stays.
drop function if exists public.place_homestead_pipe(uuid, integer, integer, text);
drop function if exists public.remove_homestead_pipe(uuid, integer, integer);
drop function if exists public.aim_homestead_pipe(uuid, integer, integer, smallint);
