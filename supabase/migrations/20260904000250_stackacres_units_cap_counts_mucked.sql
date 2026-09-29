-- The cap on homestead_units_enforce_stock_shape (20260903180000) counted
-- only `status = 'working'` rows, mirroring the old plot trigger's own
-- working-only count. That was wrong to carry over: the old plot trigger's
-- count only ever needed to be working-only because a MUCKED plot already
-- physically occupied a tile no other row could claim -- the cap and the
-- muck fee were two separate brakes on the same pedal. A unit has no tile.
-- Counting only working rows against the cap means a mucked unit stops
-- costing anything at all: buy a fresh one instead of ever paying the fee,
-- and "the cost of turning ground over between stockings" -- muck's whole
-- reason to exist -- never actually costs anything. Caught before this table
-- saw any real write beyond its own backfill.
--
-- Fixed by counting `working` OR `mucked` -- OCCUPIED, not just earning --
-- the same change made in lib/server/stackacres-store.ts's
-- countOccupiedStackAcresUnits (renamed from countWorkingStackAcresUnits).

create or replace function public.homestead_units_enforce_stock_shape()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  yield_ceiling integer;
  occupied_count integer;
  extra_slots integer;
  cap integer;
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

  select coalesce(max(extra_slots), 0) into extra_slots
  from public.homestead_capacity
  where profile_id = new.profile_id and stock = new.stock;

  cap := 3 + extra_slots;

  -- OCCUPIED, not just working: a mucked unit still holds its slot until
  -- cleared. No `and id <> new.id` -- this is INSERT-only, so `new` is not
  -- yet a row this SELECT can see at all.
  select count(*) into occupied_count
  from public.homestead_units
  where profile_id = new.profile_id
    and stock = new.stock;

  if occupied_count >= cap then
    raise exception
      'StackAcres cap reached: % of % % already occupied', occupied_count, cap, new.stock
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.homestead_units_enforce_stock_shape() is
  'Gates what may be STOCKED (yield ceiling per stock kind, cap = 3 + purchased homestead_capacity, counting working AND mucked units as occupying a slot). Fires only on insert, so it can never block a collection, a feed, a clear, or a permanent unit''s restart.';

-- The cap-count query above (and countOccupiedStackAcresUnits) no longer
-- filters on status, so the partial working-only index from 20260903180000
-- no longer serves it -- replaced with a plain index over both statuses.
drop index if exists homestead_units_working_idx;
create index homestead_units_stock_idx
  on public.homestead_units(profile_id, stock);
