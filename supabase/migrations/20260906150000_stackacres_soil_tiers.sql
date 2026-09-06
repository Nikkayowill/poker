-- Soil tiers, and the persisted planting slot that makes a per-bed bonus
-- attributable to one crop instead of to the whole farm.
--
-- WHY THE SLOT COLUMN IS PART OF THIS AND NOT A LATER PASS. A tier that
-- speeds up growth has to answer "which crop is standing on THIS bed". Today
-- nothing does: lib/stackacres/soil.ts's `soilSlotSpotForRank` derives a
-- crop's slot from a hash of its own id, RELATIVE to its living siblings, so
-- harvesting one crop moves every sibling that hashed above it. That file
-- names this exact column as the fix ("it IS movement that a persisted slot
-- column on homestead_units would remove. That is a migration, so it is not
-- done here"). Without it the only attribution available is farm-wide, and a
-- farm-wide bonus means one 8,000 Gold Enriched bed permanently speeds up
-- every crop the player will ever sow -- the same compounding shape the Ante
-- Up wager ceilings exist to close.
--
-- NULLABLE ON PURPOSE, both columns' defaults included. `soil_slot` null
-- means "not assigned", which is what every row written before today reads
-- as, and the renderer keeps falling back to the rank hash for those. So this
-- migration needs no backfill and cannot move an existing player's crops:
-- legacy rows behave exactly as they do now, and only newly sown crops take a
-- fixed slot. That also makes the migration safe to apply BEFORE the code
-- that writes the column ships.
--
-- NO CHECK CONSTRAINT ON `soil_slot`. Deliberate, and for the reason
-- 20260827's Ante Up wager guard documents at length: every settlement here
-- is an UPDATE on this row, a CHECK re-evaluates on every UPDATE, and a row
-- that somehow held an out-of-range slot would become permanently
-- unsettleable -- a stuck crop 500ing the farm forever. An out-of-range slot
-- is harmless by comparison: `soilSlotPoint` wraps it, exactly as
-- `soilSlotSpotForRank` already wraps a rank past capacity.

alter table public.homestead_units
  add column if not exists soil_slot integer;

comment on column public.homestead_units.soil_slot is
  'The crop''s fixed planting slot, or null for "derive it from the rank hash" (every row from before 2026-09-06, and every non-crop unit). Index into the flattened slot space orderedSoilTiles x SOIL_SLOTS_PER_TILE -- see lib/stackacres/soil.ts. Deliberately unconstrained: an out-of-range value wraps rather than raising, because a CHECK here would re-evaluate on the UPDATE that settles the row.';

-- The tier a bed was bought at. NOT NULL with a default, so every existing
-- row becomes 'dirt' -- which is exactly what they are: the flat 2,000 Gold
-- bed was the only kind that ever existed, and SOIL_DEFAULT_TIER in
-- lib/stackacres/soil-tiers.ts restates this default by hand (a DDL default
-- cannot import a TypeScript module -- the same split
-- homestead_units_enforce_stock_shape already lives with).
--
-- A CHECK IS SAFE HERE, unlike on homestead_units above: this table is
-- insert-and-delete only. Nothing ever UPDATEs a soil tile row -- placing is
-- an insert, removing is a delete, and there is no version column to bump --
-- so the "a CHECK strands an in-flight row" failure mode has no UPDATE to
-- fire on. Keeping it a CHECK means an unknown tier cannot be inserted at
-- all, which is what we want for a column the shop writes.
alter table public.homestead_soil_tiles
  add column if not exists tier text not null default 'dirt';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'homestead_soil_tiles_tier_check'
  ) then
    alter table public.homestead_soil_tiles
      add constraint homestead_soil_tiles_tier_check
      check (tier in ('dirt', 'enriched', 'hydro'));
  end if;
end
$$;

comment on column public.homestead_soil_tiles.tier is
  'What the bed is made of: dirt (the historical flat-price bed), enriched (faster growth), hydro (waters its own tile). Mirrors SOIL_TIERS in lib/stackacres/soil-tiers.ts. Starter tiles are never stored in this table at all, so they are dirt by definition.';

-- Placing a tile now carries its tier.
--
-- THE OLD 3-ARG FUNCTION IS DROPPED, not left beside this one. A
-- `create or replace` with a new argument list creates an OVERLOAD rather
-- than replacing, and a 3-argument call would then be ambiguous between the
-- old function and this one's defaulted 4th parameter -- Postgres raises on
-- that rather than picking. Dropping first is what makes the 3-arg call site
-- keep working: `p_tier` defaults, so code deployed before this migration
-- still places a dirt bed correctly and this is safe to apply ahead of the
-- deploy.
drop function if exists public.place_homestead_soil_tile(uuid, integer, integer);

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
  insert into public.homestead_soil_tiles (profile_id, tx, ty, tile_order, origin, tier)
  select p_profile_id, p_tx, p_ty, coalesce(max(tile_order), -1) + 1, 'purchased', p_tier
    from public.homestead_soil_tiles
   where profile_id = p_profile_id
  on conflict (profile_id, tx, ty) do nothing
  returning * into row_out;

  return row_out;
end;
$$;

-- `public` included explicitly. Omitting it leaves a new function
-- anonymously callable through PostgREST, which has shipped twice in this
-- codebase before being caught.
revoke execute on function public.place_homestead_soil_tile(uuid, integer, integer, text)
  from public, anon, authenticated;
