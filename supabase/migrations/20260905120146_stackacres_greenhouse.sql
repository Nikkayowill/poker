-- The Greenhouse: a small, weather-sealed structure a player builds once,
-- housing up to GREENHOUSE_SLOT_CAP (6) crops at an accelerated growth rate.
-- See lib/stackacres/greenhouse.ts for the full design.
--
-- NOT A `homestead_plots` FEATURE. That table has been inert since
-- 20260903180000 deleted the plot grid outright (`homestead_units` is its
-- live successor, and StackAcres is "places, not plots" everywhere else on
-- this map now -- see lib/stackacres/world.ts's own header). The Greenhouse
-- is a permanent, once-built fact about a PROFILE, shaped exactly like
-- `homestead_sectors`: one row, written once, never updated, its primary key
-- the whole idempotency guard.
--
-- PRICED IN PROCESSING-TRACK GOODS, DEBITED THROUGH THE LIVE INVENTORY TABLE.
-- `homestead_processing_inventory` / `adjust_homestead_processing_inventory`
-- (20260904160000) is StackAcres' live single-item-space model today; the
-- OLDER `homestead_inventory` / `adjust_homestead_inventory`
-- (20260901180000) has been inert since the single-currency change deleted
-- its only writers (see 20260904200000_stackacres_synergy_tree.sql's own
-- header on why writing anything new into that table would make it silently
-- live again). Flour and Cloth are both already valid
-- `homestead_processing_inventory.item` values (verified against the live
-- check constraint via execute_sql before writing this, not trusted from the
-- migration source alone -- see CLAUDE.md's own caution on that).

/* -------------------------------------------------------------------- */
/* The Greenhouse itself                                                */
/* -------------------------------------------------------------------- */

create table public.homestead_greenhouse (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  built_at timestamptz not null default now()
);

comment on table public.homestead_greenhouse is
  'Whether a player has built their Greenhouse (lib/stackacres/greenhouse.ts). One row per profile, permanent, never refunded -- same posture as homestead_sectors. Service-role only.';

alter table public.homestead_greenhouse enable row level security;
revoke all on public.homestead_greenhouse from anon, authenticated;

/* -------------------------------------------------------------------- */
/* housed_in on homestead_units                                         */
/* -------------------------------------------------------------------- */

alter table public.homestead_units
  add column if not exists housed_in text check (housed_in is null or housed_in = 'greenhouse');

comment on column public.homestead_units.housed_in is
  'Non-null only for a crop stocked into the built Greenhouse. Gates the growth-acceleration baseline and ambient-weather isolation; see lib/stackacres/greenhouse.ts. Set once at stocking (stockStackAcres), never changed after.';

-- The hot path this feeds is "how many of THIS profile's units are housed
-- right now", read on every greenhouse stocking attempt and by the trigger
-- below -- the same partial-index shape homestead_units_working_idx already
-- takes for its own per-profile, per-condition count.
create index homestead_units_greenhouse_idx
  on public.homestead_units(profile_id)
  where housed_in = 'greenhouse';

/* -------------------------------------------------------------------- */
/* Extending the stocking trigger: greenhouse slot cap + allowed stock   */
/* -------------------------------------------------------------------- */

-- CREATE OR REPLACE against the LIVE function body (fetched via execute_sql
-- immediately before writing this, not the original migration's source text,
-- which had already drifted -- see CLAUDE.md's migrations-not-auto-applied
-- caution). Adds exactly one new branch; every existing check (yield
-- ceiling, per-kind cap) is untouched.
create or replace function public.homestead_units_enforce_stock_shape()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  yield_ceiling integer;
  occupied_count integer;
  v_extra_slots integer;
  cap integer;
  greenhouse_built boolean;
  greenhouse_occupied integer;
begin
  yield_ceiling := case new.stock
    when 'sprout' then 3
    when 'cash_crop' then 5
    when 'hen' then 4
    when 'pig' then 6
    when 'cattle' then 8
    else null
  end;

  if yield_ceiling is not null and new.yield_quantity > yield_ceiling then
    raise exception
      'StackAcres yield % exceeds the ceiling of % for %',
      new.yield_quantity, yield_ceiling, new.stock
      using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext(new.profile_id::text));

  select coalesce(max(extra_slots), 0) into v_extra_slots
  from public.homestead_capacity
  where profile_id = new.profile_id and stock = new.stock;

  cap := 3 + v_extra_slots;

  select count(*) into occupied_count
  from public.homestead_units
  where profile_id = new.profile_id
    and stock = new.stock;

  if occupied_count >= cap then
    raise exception
      'StackAcres cap reached: % of % % already occupied', occupied_count, cap, new.stock
      using errcode = 'check_violation';
  end if;

  -- NEW: the Greenhouse gate. Only reached at all when this row asks to be
  -- housed -- an ordinary open-air stocking (the overwhelming majority of
  -- inserts) never touches any of this.
  if new.housed_in = 'greenhouse' then
    -- Keep in step with lib/stackacres/greenhouse.ts's GREENHOUSE_ALLOWED_STOCK.
    -- Duplicated on purpose, same reason as yield_ceiling above: a trigger
    -- cannot import a TypeScript module, and a retune that moves one without
    -- the other turns a permitted stocking into a 500 instead of a clean 400.
    if new.stock not in ('sprout', 'cash_crop') then
      raise exception 'StackAcres Greenhouse only houses crops, not %', new.stock
        using errcode = 'check_violation';
    end if;

    select exists(select 1 from public.homestead_greenhouse where profile_id = new.profile_id)
      into greenhouse_built;
    if not greenhouse_built then
      raise exception 'StackAcres Greenhouse has not been built yet'
        using errcode = 'check_violation';
    end if;

    -- Kept in step with lib/stackacres/greenhouse.ts's GREENHOUSE_SLOT_CAP (6).
    select count(*) into greenhouse_occupied
    from public.homestead_units
    where profile_id = new.profile_id
      and housed_in = 'greenhouse';

    if greenhouse_occupied >= 6 then
      raise exception 'StackAcres Greenhouse full: % of 6 slots already occupied', greenhouse_occupied
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.homestead_units_enforce_stock_shape() is
  'Gates what may be STOCKED: yield ceiling per stock kind, cap = 3 + purchased homestead_capacity, and (new) the Greenhouse''s own crop-only/built/6-slot gate. Fires only on insert, so it can never block a collection, a feed, or a permanent unit''s restart.';

revoke execute on function public.homestead_units_enforce_stock_shape() from public, anon, authenticated;

/* -------------------------------------------------------------------- */
/* Building it: a strict, row-locked, all-or-nothing debit               */
/* -------------------------------------------------------------------- */

-- WHY FOR UPDATE, on top of the advisory lock. The advisory lock alone fully
-- serializes concurrent calls to THIS function for one profile -- a second
-- build attempt blocks until the first commits, then sees the row this one
-- inserted and returns false having spent nothing. It does NOT serialize
-- against a DIFFERENT concurrent spender of the same Flour/Cloth (a Mill
-- recipe fulfilling at the same moment): that spender does not take this
-- advisory lock at all. Locking both cost-line rows with FOR UPDATE closes
-- that gap -- a concurrent recipe fulfillment genuinely queues behind this
-- transaction for those two rows, so the balance this function validates is
-- the balance it debits, not a balance that could have changed in between.
create or replace function public.build_homestead_greenhouse(
  p_profile_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  flour_needed integer := 20; -- Keep in step with GREENHOUSE_BUILD_COST in lib/stackacres/greenhouse.ts.
  cloth_needed integer := 12;
  flour_qty integer;
  cloth_qty integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_profile_id::text || ':greenhouse'));

  if exists (select 1 from public.homestead_greenhouse where profile_id = p_profile_id) then
    return false;
  end if;

  select quantity into flour_qty
  from public.homestead_processing_inventory
  where profile_id = p_profile_id and item = 'flour'
  for update;

  select quantity into cloth_qty
  from public.homestead_processing_inventory
  where profile_id = p_profile_id and item = 'cloth'
  for update;

  if coalesce(flour_qty, 0) < flour_needed or coalesce(cloth_qty, 0) < cloth_needed then
    raise exception 'Not enough materials for a Greenhouse (need % Flour, % Cloth)', flour_needed, cloth_needed
      using errcode = 'check_violation';
  end if;

  -- Reuses adjust_homestead_processing_inventory for the actual debit, as
  -- asked: both rows are already locked by this transaction's own FOR UPDATE
  -- above, so its internal UPDATE re-uses that same lock rather than racing
  -- it.
  perform public.adjust_homestead_processing_inventory(p_profile_id, 'flour', -flour_needed);
  perform public.adjust_homestead_processing_inventory(p_profile_id, 'cloth', -cloth_needed);

  insert into public.homestead_greenhouse (profile_id) values (p_profile_id);

  return true;
end;
$$;

comment on function public.build_homestead_greenhouse(uuid) is
  'Builds a player''s Greenhouse exactly once: an advisory lock serializes concurrent build attempts, FOR UPDATE locks the Flour/Cloth cost-line rows against any other concurrent spender, then both are debited via adjust_homestead_processing_inventory and the permanent row is inserted, all in one transaction. Returns false (spending nothing) if the Greenhouse already exists; raises check_violation (spending nothing) if the materials are short.';

-- `public` is load-bearing and not redundant -- see release_homestead_exchange
-- (20260904150000)'s own comment on why omitting it is a silent no-op. This
-- function has shipped wrong twice on other StackAcres features already
-- (20260901130000, 20260813170000); verify with proacl after applying, not by
-- re-reading this file.
revoke all on function public.build_homestead_greenhouse(uuid) from public, anon, authenticated;
