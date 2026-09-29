/* -------------------------------------------------------------------- */
/* Clearing land: what stands on a field until the player cuts it down   */
/* -------------------------------------------------------------------- */

-- One row per (profile, obstacle). `obstacle_id` is one of the fixed ids in
-- lib/stackacres/land-clearing.ts (LAND_OBSTACLES), not free text, the same
-- posture homestead_wood_nodes takes for `node_id`: application code owns
-- which ids exist.
--
-- A missing row is an obstacle nobody has touched, which is standing. Rows
-- are created lazily on a profile's first swing, so a farm that never walks
-- onto the Fold stores nothing about it.
--
-- Nothing here regrows. `cleared_at` is the end of that obstacle for that
-- farm, which is why this is not modelled on the wood node's respawn clock.
create table public.homestead_land_obstacles (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  obstacle_id text not null,
  hits_remaining integer not null check (hits_remaining >= 0),
  cleared_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  primary key (profile_id, obstacle_id)
);

comment on table public.homestead_land_obstacles is
  'One obstacle''s state per profile while a sector is being cleared: swings left, and when it came down if it did. Version-guarded compare-and-swap, same shape homestead_wood_nodes uses -- see writeStackAcresLandObstacleSwing in lib/server/stackacres-store.ts. A missing row reads as standing and untouched. Land is never bought; a sector opens when its last obstacle here is cleared. Service-role only.';

alter table public.homestead_land_obstacles enable row level security;
revoke all on public.homestead_land_obstacles from anon, authenticated;

-- The one read the farm snapshot makes: every obstacle this profile has
-- touched, to work out how far each sector has got.
create index if not exists homestead_land_obstacles_profile_idx
  on public.homestead_land_obstacles (profile_id);
