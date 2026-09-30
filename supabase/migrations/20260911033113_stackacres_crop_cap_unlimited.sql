-- Crops drop the per-kind stocking cap. It only ever existed to bound a
-- physical pen, and a crop bed was never that -- lib/stackacres/catalogue.ts's
-- STACKACRES_BASE_CAP header has the reasoning. Livestock (hen/pig/cattle)
-- keeps the existing 3-free/+3-purchased cap unchanged; only the crop branch
-- of homestead_units_enforce_stock_shape is new here.
--
-- Skipping the cap block entirely for crops also skips the advisory lock and
-- the homestead_capacity read for every crop insert, which used to run for
-- no reason once a crop's cap could never be raised past 6 anyway.

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

  -- Only livestock is capped now -- a crop kind may run as many units as a
  -- player can seed.
  if new.stock not in ('hen', 'pig', 'cattle') then
    return new;
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
  'Gates what may be STOCKED: a yield ceiling per stock kind, plus a cap (3 + purchased homestead_capacity, counting working AND mucked units as occupying a slot) that applies only to livestock -- hen/pig/cattle. Crops are uncapped. Fires only on insert, so it can never block a collection, a feed, a clear, or a permanent unit''s restart.';
