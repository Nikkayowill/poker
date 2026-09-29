-- Irrigation: which way a lone pipe tile points.
--
-- Cosmetic only. `facing` is one of the four neighbour bits (1 N, 2 E, 4 S,
-- 8 W) or null, and the client only draws it while the tile's derived
-- `mask` is 0 -- the moment a neighbour joins, `mask` describes the real
-- connections and this is ignored (kept, not cleared, so lifting that
-- neighbour again leaves the stub pointing where it did). Hydration and
-- flow never read it: recalculatePipeConnections (lib/stackacres/
-- irrigation.ts) still builds `mask`/`hydrated`/`distance` from occupancy
-- alone, and sync_homestead_pipe_network is unchanged. No money moves.
--
-- Not a derived column, so it is not written by the sync; the one writer is
-- aim_homestead_pipe below, called by aimStackAcresPipeTile
-- (lib/server/stackacres-service.ts). A well never has one -- the update is
-- scoped to kind = 'pipe' -- and there is nothing here to enforce on insert
-- beyond the CHECK, so the cap trigger is untouched.

alter table public.homestead_pipes
  add column facing smallint
    check (facing is null or facing in (1, 2, 4, 8));

comment on column public.homestead_pipes.facing is
  'Cosmetic: which way a lone pipe stub points (1 N, 2 E, 4 S, 8 W), or null for the default elbow. Drawn only while the derived mask is 0; never read by the hydration recompute.';

comment on table public.homestead_pipes is
  'One irrigation tile per row, on the STACKACRES_TILE lattice (tx/ty are floor(worldX / 16), floor(worldY / 16)). kind: a well is a fluid source, a pipe carries water. mask (0..15, bit 0 N / 1 E / 2 S / 3 W), hydrated and distance (BFS steps from the nearest well, <= 8) are DERIVED -- recomputed in TypeScript by recalculatePipeConnections and written back by sync_homestead_pipe_network, never set by hand. facing is a cosmetic aim for a lone stub, set by aim_homestead_pipe.';

-- Point one pipe tile. Returns the number of rows touched (0 or 1): 0 for a
-- coordinate with no pipe on it, or with the well on it. version bumps so a
-- client diffing on it redraws the stub.
create or replace function public.aim_homestead_pipe(
  p_profile_id uuid,
  p_tx integer,
  p_ty integer,
  p_facing smallint
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  if p_facing is null or p_facing not in (1, 2, 4, 8) then
    raise exception 'unknown pipe facing %', p_facing using errcode = 'check_violation';
  end if;

  update public.homestead_pipes
     set facing = p_facing,
         version = version + 1
   where profile_id = p_profile_id
     and tx = p_tx
     and ty = p_ty
     and kind = 'pipe'
     and facing is distinct from p_facing;
  get diagnostics touched = row_count;
  return touched;
end;
$$;

revoke execute on function public.aim_homestead_pipe(uuid, integer, integer, smallint)
  from public, anon, authenticated;
