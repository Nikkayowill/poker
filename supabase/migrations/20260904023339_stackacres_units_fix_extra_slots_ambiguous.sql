-- homestead_units_enforce_stock_shape (20260903190000) declared a local
-- variable named extra_slots and then selected max(extra_slots) from
-- homestead_capacity, which has a column of the same name. With
-- plpgsql.variable_conflict = error (the default), that's ambiguous --
-- Postgres can't tell the local variable from the column -- so every
-- single stock insert raised "column reference \"extra_slots\" is
-- ambiguous" and stocking anything has been broken since this shipped.
-- No test caught it because the memory-mode store never runs this trigger
-- against a real Postgres.
--
-- Fixed by renaming the local variable to v_extra_slots; no other change.
--
-- This migration file was missing from source control even though the fix
-- was already applied directly to the live database on 2026-09-04 (this
-- file's own timestamp is that applied version) -- landing it here so a
-- fresh environment/db reset reproduces the real schema instead of
-- silently missing the fix.

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
