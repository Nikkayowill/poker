-- Relocating an already-placed bed (hold-tap to lift, tap to drop --
-- lib/stackacres/soil.ts's `planSoilGroupRelocation`/`moveSoilTileGroup`).
--
-- WHY A NEW FUNCTION rather than a remove-then-place pair: a tile's
-- `tile_order` is the only thing that fixes which crop's `soil_slot` points
-- at it (see lib/stackacres/soil.ts's header on `soilSlotSpot`). Removing a
-- row and reinserting it hands out a fresh `tile_order` and reshuffles every
-- later tile's slot index -- this function only ever writes `tx`/`ty` on the
-- existing row, so `tile_order`, `origin` and `tier` never move and every
-- crop standing on the group keeps resolving to the same beds.
--
-- p_moves is a jsonb array of `{from_tx, from_ty, to_tx, to_ty}`, one entry
-- per tile in the contiguous group moving together (the whole group
-- translates by the same offset, but this function does not assume that --
-- it re-derives legality from the current table, the same posture
-- place_homestead_soil_tile's own exists-check takes).
--
-- TWO CUSTOM SQLSTATEs, same reason ST003 exists on the sibling function:
-- ST004 is "a destination is already held by a bed outside this group" (the
-- caller reports this exactly like place's "already a bed there"), ST005 is
-- "one of the FROM tiles no longer stands" (the caller's plan was built off
-- a layout that changed since -- reported as "try again", not a 500).
--
-- THE TWO-PHASE UPDATE. A group can shuffle internally -- one tile's
-- destination is another tile's current position -- and the table's own
-- (profile_id, tx, ty) unique index is checked per row as a single UPDATE
-- statement writes it, not deferred to the statement's end. Writing final
-- positions directly could therefore trip that index against a sibling row
-- this same call is about to move out of the way, depending on write order.
-- Staging every moving tile at (tx + 1_000_000, ty + 1_000_000) first sidesteps
-- that entirely: the offset is far outside any real coordinate (CROP_FIELD_BEDS
-- is a 384-unit box measured in SOIL_TILE=16 steps, nowhere near a million),
-- and offsetting every moving tile by the same constant preserves their
-- pairwise distinctness, so the staging update can never collide with itself.
create or replace function public.move_homestead_soil_tile_group(
  p_profile_id uuid,
  p_moves jsonb
)
returns setof public.homestead_soil_tiles
language plpgsql
security definer
set search_path = public
as $$
declare
  move_count integer;
  from_count integer;
  collision_count integer;
begin
  select count(*) into move_count from jsonb_array_elements(p_moves);
  if move_count = 0 then
    return;
  end if;

  select count(*) into from_count
    from jsonb_to_recordset(p_moves) as m(from_tx integer, from_ty integer, to_tx integer, to_ty integer)
    join public.homestead_soil_tiles t
      on t.profile_id = p_profile_id and t.tx = m.from_tx and t.ty = m.from_ty;
  if from_count <> move_count then
    raise exception using errcode = 'ST005', message = 'soil_group_stale';
  end if;

  select count(*) into collision_count
    from jsonb_to_recordset(p_moves) as m(from_tx integer, from_ty integer, to_tx integer, to_ty integer)
    join public.homestead_soil_tiles t
      on t.profile_id = p_profile_id and t.tx = m.to_tx and t.ty = m.to_ty
   where not exists (
     select 1 from jsonb_to_recordset(p_moves) as g(from_tx integer, from_ty integer, to_tx integer, to_ty integer)
      where g.from_tx = t.tx and g.from_ty = t.ty
   );
  if collision_count > 0 then
    raise exception using errcode = 'ST004', message = 'soil_group_blocked';
  end if;

  update public.homestead_soil_tiles t
     set tx = m.from_tx + 1000000, ty = m.from_ty + 1000000
    from jsonb_to_recordset(p_moves) as m(from_tx integer, from_ty integer, to_tx integer, to_ty integer)
   where t.profile_id = p_profile_id and t.tx = m.from_tx and t.ty = m.from_ty;

  update public.homestead_soil_tiles t
     set tx = m.to_tx, ty = m.to_ty
    from jsonb_to_recordset(p_moves) as m(from_tx integer, from_ty integer, to_tx integer, to_ty integer)
   where t.profile_id = p_profile_id and t.tx = m.from_tx + 1000000 and t.ty = m.from_ty + 1000000;

  return query
    select t.* from public.homestead_soil_tiles t
     join jsonb_to_recordset(p_moves) as m(from_tx integer, from_ty integer, to_tx integer, to_ty integer)
       on t.profile_id = p_profile_id and t.tx = m.to_tx and t.ty = m.to_ty;
end;
$$;

revoke execute on function public.move_homestead_soil_tile_group(uuid, jsonb)
  from public, anon, authenticated;
