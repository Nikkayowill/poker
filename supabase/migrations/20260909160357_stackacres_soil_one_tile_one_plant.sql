-- A soil bed shrinks from 4 art units (holding up to a dozen planting
-- squares, bought one at a time) down to 1 -- one tile, one plant, matching
-- the same base lattice ./irrigation.ts's pipes already snap to.
--
-- WHY. Buying a bed one furrowed square at a time made placing soil feel
-- like buying real estate rather than planting: a player wanted to drop a
-- seed on the tile their thumb was over, not fill a bed's twelfth square.
-- lib/stackacres/soil.ts's own header has the full rationale.
--
-- `bought_slots` is dropped outright rather than kept and ignored: it exists
-- to say how many of a bed's dozen squares are owned, and a bed no longer
-- has squares to own -- either it exists (one plant) or it does not. Safe to
-- drop with no backfill or migration of existing rows: this table holds zero
-- rows in production as of 2026-09-09 (checked directly before writing this
-- migration), so there is nothing to reconcile.
alter table public.homestead_soil_tiles
  drop constraint if exists homestead_soil_tiles_bought_slots_check;

alter table public.homestead_soil_tiles
  drop column if exists bought_slots;

-- Replaces the per-square grower from 20260907180000_stackacres_soil_per_square.sql
-- with a plain insert-or-refuse: a bed is one tile now, so there is nothing
-- left to grow and no tier to mismatch against a partially-filled bed.
--
-- ONE CUSTOM SQLSTATE (ST003) rather than a plain default-coded RAISE, same
-- reason the function it replaces used ST001/ST002: the application layer
-- (lib/server/stackacres-soil-store.ts) needs to tell "a bed already stands
-- here" apart from a genuine error, to refund the bag and word the refusal
-- correctly rather than 500ing.
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
  select p_profile_id, p_tx, p_ty, coalesce(max(tile_order), -1) + 1, 'purchased', p_tier
    from public.homestead_soil_tiles
   where profile_id = p_profile_id
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
