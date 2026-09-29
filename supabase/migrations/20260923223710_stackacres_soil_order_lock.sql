-- Two hoes on different squares used to run this function at the same time,
-- both read the same max(tile_order), and both beds got the same order. A
-- bed's order is its slot, so the two beds shared one slot: a crop drew on
-- the wrong bed, and sowing the other one landed somewhere else.
--
-- A per-farm transaction lock makes the second hoe wait for the first to
-- commit, so it reads the first bed's order before picking its own. Same body
-- as 20260914044021 otherwise.
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
  perform pg_advisory_xact_lock(hashtextextended('homestead_soil_order:' || p_profile_id::text, 0));

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
  -- that exactly like every other refusal.
  return row_out;
end;
$$;

-- `public` included explicitly. Omitting it leaves this callable
-- anonymously through PostgREST.
revoke execute on function public.place_homestead_soil_tile(uuid, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.place_homestead_soil_tile(uuid, integer, integer, text)
  to service_role;
