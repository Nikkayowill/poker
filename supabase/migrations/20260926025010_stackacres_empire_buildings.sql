/* -------------------------------------------------------------------- */
/* Buildings the player buys and places on the Far Field                 */
/* -------------------------------------------------------------------- */

-- Metal pays for these buildings; iron ore is what it is smelted from (the
-- next step). Both join the inventory's item list here so it only has to be
-- rewritten once. Same list as 20260920200000_stackacres_wood_stone_inventory
-- plus the two new items; checked against production before writing.
alter table public.homestead_processing_inventory
  drop constraint if exists homestead_processing_inventory_item_check;

alter table public.homestead_processing_inventory
  add constraint homestead_processing_inventory_item_check
  check (item in (
    'wheat', 'flour', 'milk', 'wool', 'cheese', 'cloth', 'cake', 'bread', 'stew', 'salad',
    'cattle_feed', 'sauce', 'salsa', 'stuffed_peppers', 'pickles', 'sauerkraut',
    'bean_casserole', 'harvest_feast',
    'eggs',
    'garlic', 'onion', 'beet', 'poppy', 'potato', 'carrot', 'cabbage',
    'cucumber', 'pepper', 'brokoly', 'sunflower', 'sunflowe_broken', 'wheat1', 'tomato',
    'corn', 'corn2', 'eggplant', 'grap', 'grap2', 'pumpkin', 'wheat2', 'artichoke',
    'lettuce', 'spinach', 'radish', 'broccoli', 'bell_pepper', 'celery', 'green_bean',
    'bluegill', 'trout', 'catfish',
    'meat', 'pelt',
    'wood', 'stone',
    'iron_ore', 'metal'
  ));

-- One row per building a player owns. tx/ty are the Far Field map tiles of
-- the building's top-left corner, or both null while it is picked up and in
-- storage. w/h are its footprint in tiles when it was placed, so the overlap
-- check below never needs the building catalogue. Where a building may go
-- (the map's own trees and walls, the bridge, doors kept reachable) is
-- application code's call, lib/stackacres/empire-buildings.ts; the database
-- only makes sure two of one player's buildings never overlap.
create table public.empire_buildings (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('barn')),
  tx integer check (tx >= 0),
  ty integer check (ty >= 0),
  w integer not null check (w > 0),
  h integer not null check (h > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint empire_buildings_spot_whole check ((tx is null) = (ty is null))
);

create index empire_buildings_profile_idx on public.empire_buildings (profile_id);

comment on table public.empire_buildings is
  'Buildings a profile owns on the Far Field, placed (tx/ty set) or in storage (both null). Bought once with Gold, Wood and Metal by the service; placed and moved only through place_empire_building. Service-role only.';

alter table public.empire_buildings enable row level security;
revoke all on public.empire_buildings from anon, authenticated;

-- Puts a building down at (p_tx, p_ty): a new one (p_id null, already paid
-- for by the caller) or one the player owns, moved or taken out of storage.
-- One farm's placements are serialised so two taps cannot stand buildings
-- on top of each other.
--
-- The rules that need the map (doors kept reachable, the bridge kept clear)
-- are checked by the caller against the layout it read. p_expected is that
-- layout (lib/stackacres/empire-buildings.ts `layoutFingerprint`): placed
-- buildings as id:tx:ty, by id, joined by commas. If the layout has changed
-- since, this refuses with 'stale' and the caller checks again.
--
-- Returns the building's id, or why not: 'stale', 'overlap' (another of this
-- player's buildings is in the way) or 'missing' (no such building of
-- theirs). A caller that paid for a new building refunds on any of them.
create or replace function public.place_empire_building(
  p_profile_id uuid,
  p_id uuid,
  p_kind text,
  p_tx integer,
  p_ty integer,
  p_w integer,
  p_h integer,
  p_expected text
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  placed_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('empire_buildings:' || p_profile_id::text));

  if coalesce((
    select string_agg(b.id::text || ':' || b.tx || ':' || b.ty, ',' order by b.id)
      from public.empire_buildings b
     where b.profile_id = p_profile_id and b.tx is not null
  ), '') <> p_expected then
    return 'stale';
  end if;

  if exists (
    select 1 from public.empire_buildings b
     where b.profile_id = p_profile_id
       and b.tx is not null
       and (p_id is null or b.id <> p_id)
       and b.tx < p_tx + p_w and p_tx < b.tx + b.w
       and b.ty < p_ty + p_h and p_ty < b.ty + b.h
  ) then
    return 'overlap';
  end if;

  if p_id is null then
    insert into public.empire_buildings (profile_id, kind, tx, ty, w, h)
    values (p_profile_id, p_kind, p_tx, p_ty, p_w, p_h)
    returning id into placed_id;
    return placed_id::text;
  end if;

  update public.empire_buildings
     set tx = p_tx, ty = p_ty, w = p_w, h = p_h, updated_at = now()
   where id = p_id and profile_id = p_profile_id
  returning id into placed_id;
  if placed_id is null then
    return 'missing';
  end if;
  return placed_id::text;
end;
$$;

revoke execute on function public.place_empire_building(uuid, uuid, text, integer, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.place_empire_building(uuid, uuid, text, integer, integer, integer, integer, text) to service_role;
