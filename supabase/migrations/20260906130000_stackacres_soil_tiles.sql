-- Placeable soil beds: the Gold-sink customization layer on top of
-- lib/stackacres/soil.ts's own lattice (64-unit tiles, tx/ty = floor(worldX
-- / SOIL_TILE), floor(worldY / SOIL_TILE)).
--
-- OWN TABLE, OWN RPCs, same shape as homestead_pipes
-- (20260906120000_stackacres_irrigation.sql): a small per-row table, a
-- unique (profile_id, tx, ty) index doing the "already occupied" refusal for
-- free, service-role only.
--
-- STARTER TILES ARE NOT STORED HERE. lib/stackacres/soil.ts's own
-- `starterSoilTiles` derives the two free tiles fresh from growAreaBounds on
-- every load -- that is deliberate (see its own header: "without anything
-- being persisted") and this table only ever holds `origin = 'purchased'`
-- rows. A starter tile can therefore never collide with a purchased one at
-- this table's own unique index, because it is never inserted here at all.
--
-- MONEY. Gold moves in the application layer, not this migration -- the
-- same split place_homestead_pipe takes. placeStackAcresSoilTile spends via
-- spend_gold_by_profile BEFORE calling place_homestead_soil_tile, and
-- refunds if the insert reports the cell already taken. Removing a tile
-- moves no Gold at all (no refund, matching every other retire/clear
-- convention in this codebase).

create table public.homestead_soil_tiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  tx integer not null,
  ty integer not null,
  tile_order integer not null,
  origin text not null check (origin in ('starter', 'purchased')),
  created_at timestamptz not null default now(),
  unique (profile_id, tx, ty)
);

comment on table public.homestead_soil_tiles is
  'One placed soil bed per row, on the SOIL_TILE lattice (tx/ty are floor(worldX / 64), floor(worldY / 64) -- see lib/stackacres/soil.ts). tile_order is the placement sequence orderedSoilTiles sorts by; starter tiles are never stored here, only origin = ''purchased'' rows are.';

alter table public.homestead_soil_tiles enable row level security;
revoke all on public.homestead_soil_tiles from anon, authenticated;

create index homestead_soil_tiles_profile_idx on public.homestead_soil_tiles (profile_id);

-- Place one tile. The next tile_order is max-plus-one over this profile's
-- own purchased rows, computed inside the same insert -- mirrors
-- nextSoilOrder's own "max-plus-one, not size" reasoning in soil.ts: two
-- concurrent placements landing on different cells may compute the same
-- tile_order, which is harmless (orderedSoilTiles ties-break on the
-- coordinate), while the unique index is what actually serialises two
-- placements racing for the SAME cell -- the loser's insert reports a
-- conflict and this function returns null rather than raising, so the
-- caller can refund the Gold it already spent instead of the request
-- throwing.
create or replace function public.place_homestead_soil_tile(
  p_profile_id uuid,
  p_tx integer,
  p_ty integer
)
returns public.homestead_soil_tiles
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out public.homestead_soil_tiles;
begin
  insert into public.homestead_soil_tiles (profile_id, tx, ty, tile_order, origin)
  select p_profile_id, p_tx, p_ty, coalesce(max(tile_order), -1) + 1, 'purchased'
    from public.homestead_soil_tiles
   where profile_id = p_profile_id
  on conflict (profile_id, tx, ty) do nothing
  returning * into row_out;

  return row_out;
end;
$$;

revoke execute on function public.place_homestead_soil_tile(uuid, integer, integer)
  from public, anon, authenticated;

-- Removes one tile, IF it is a purchased one. A starter tile is permanent
-- (soil.ts: "the free starter beds") and refuses here rather than the
-- caller having to check origin before asking -- a missing row and a
-- starter row both return false, telling the caller nothing was removed
-- either way.
create or replace function public.remove_homestead_soil_tile(
  p_profile_id uuid,
  p_tx integer,
  p_ty integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.homestead_soil_tiles
   where profile_id = p_profile_id
     and tx = p_tx
     and ty = p_ty
     and origin = 'purchased';
  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;

revoke execute on function public.remove_homestead_soil_tile(uuid, integer, integer)
  from public, anon, authenticated;
