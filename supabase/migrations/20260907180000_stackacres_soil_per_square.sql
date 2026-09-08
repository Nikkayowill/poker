-- Soil beds are bought one planting square at a time now, not all
-- SOIL_SLOTS_PER_TILE (twelve) squares in one purchase.
--
-- WHY. A player buying one 64-unit bed got twelve free plant slots for one
-- price -- pay once, drop up to twelve different crops into it. That is not
-- how a real garden bed gets dug: a square of ground is for one seed. Ray's
-- shelf still sells bags per tier, but a bag is now one square
-- (lib/stackacres/soil-tiers.ts's SOIL_TIER_DEFS.price is repriced from the
-- old whole-bed cost down by SOIL_SLOTS_PER_TILE, so filling an entire bed
-- one square at a time still costs the same total it always did), and
-- placing a bag either starts a brand new one-square bed on bare ground or
-- grows the bed already standing there by one more square.
--
-- `bought_slots` NOT NULL DEFAULT 12 -- the FULL count, not zero. Every row
-- written before today is a bed bought under the old flat price, and that
-- price bought all twelve squares; a player who already paid for a whole bed
-- keeps everything they paid for. Postgres backfills every existing row to
-- this default the moment the column is added, so this needs no separate
-- UPDATE and cannot silently strand an old bed at one owned square. Only a
-- bed placed by the NEW `place_homestead_soil_tile` below ever starts at 1.
--
-- A CHECK IS SAFE HERE, unlike a wager ceiling elsewhere in this codebase
-- (see homestead_units.soil_slot's own note, and the Ante Up wager-ceiling
-- history): a CHECK re-evaluating on every UPDATE only strands a row if some
-- LATER retune narrows the valid range underneath rows already written. The
-- range here (1..SOIL_SLOTS_PER_TILE) is a fixed property of the physical
-- lattice, not a tunable number -- a bed structurally cannot hold more than
-- twelve squares or fewer than one, today or in any future retune, so this
-- CHECK can never fire against a row that was valid when written.
alter table public.homestead_soil_tiles
  add column if not exists bought_slots integer not null default 12;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'homestead_soil_tiles_bought_slots_check'
  ) then
    alter table public.homestead_soil_tiles
      add constraint homestead_soil_tiles_bought_slots_check
      check (bought_slots between 1 and 12);
  end if;
end
$$;

comment on column public.homestead_soil_tiles.bought_slots is
  'How many of this bed''s SOIL_SLOTS_PER_TILE (12) planting squares are actually owned, filled in reading order -- see soilSlotPoint in lib/stackacres/soil.ts. Every row from before 2026-09-07 defaults to 12 (a whole bed, bought under the old flat per-bed price); only a bed placed by the new place_homestead_soil_tile starts at 1 and grows one square per bag.';

-- Buying a bag now either creates a one-square bed or grows an existing one
-- by a square, instead of only ever inserting a brand new whole bed.
--
-- THIS TABLE WAS INSERT-AND-DELETE ONLY before today (see
-- 20260906150000_stackacres_soil_tiers.sql's own note on why that made a
-- CHECK on `tier` safe there). Growing a bed's `bought_slots` is this
-- table's first-ever UPDATE -- see the CHECK constraint's own comment above
-- for why that does not reopen the "a CHECK strands an in-flight row" trap:
-- every UPDATE this function issues moves `bought_slots` up by exactly one,
-- guarded to never exceed SOIL_SLOTS_PER_TILE before the UPDATE runs, so the
-- CHECK it must still satisfy can never be the thing that fails.
--
-- TWO CUSTOM SQLSTATES rather than a plain default-coded RAISE, because the
-- application layer needs to tell "this bed is full" apart from "this bed is
-- a different tier" to refund the bag and word the refusal correctly
-- (lib/server/stackacres-soil-store.ts reads these codes back). ST001's
-- MESSAGE is the bed's own tier text, not a sentence -- the application
-- layer reads it directly as the tier id (degrading through toSoilTier if it
-- is ever anything else) rather than this function having to know the
-- English a mismatch should read as.
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
  existing public.homestead_soil_tiles;
begin
  select * into existing
    from public.homestead_soil_tiles
   where profile_id = p_profile_id and tx = p_tx and ty = p_ty
   for update;

  if existing.id is null then
    insert into public.homestead_soil_tiles (profile_id, tx, ty, tile_order, origin, tier, bought_slots)
    select p_profile_id, p_tx, p_ty, coalesce(max(tile_order), -1) + 1, 'purchased', p_tier, 1
      from public.homestead_soil_tiles
     where profile_id = p_profile_id
    on conflict (profile_id, tx, ty) do nothing
    returning * into row_out;

    -- null here means a concurrent insert won the race for this exact bare
    -- cell between the select above and this insert; the caller treats that
    -- exactly like every other refusal and refunds the bag.
    return row_out;
  end if;

  if existing.tier <> p_tier then
    raise exception using errcode = 'ST001', message = existing.tier;
  end if;

  if existing.bought_slots >= 12 then
    raise exception using errcode = 'ST002', message = 'soil_bed_full';
  end if;

  update public.homestead_soil_tiles
     set bought_slots = bought_slots + 1
   where id = existing.id
  returning * into row_out;

  return row_out;
end;
$$;

-- `public` included explicitly. Omitting it leaves this callable
-- anonymously through PostgREST, which has shipped twice in this codebase
-- before being caught.
revoke execute on function public.place_homestead_soil_tile(uuid, integer, integer, text)
  from public, anon, authenticated;
