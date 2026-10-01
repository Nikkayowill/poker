-- The barn routine: animals get a daily tend, a care streak and a small
-- capped bonus to the batch they are already growing, plus a twelfth machine
-- kind (the Barn) that buys comfort and room rather than production.
--
-- NO GOLD MOVES HERE. The tend spends nothing; the Barn is placed through the
-- existing machine placement path, which is where its Gold is debited.

-- Three columns on the unit, all defaulted, so every animal already in the
-- ground loads as "never tended" with no backfill pass.
alter table public.homestead_units
  add column if not exists cared_on date,
  add column if not exists care_streak integer not null default 0,
  add column if not exists care_bonus integer not null default 0;

-- CARE_BONUS_CAP in lib/stackacres/barn.ts is 2, and this is the database
-- saying the same thing. The service clamps before it writes; this is what
-- makes the clamp true even if a future call site forgets to. Same
-- belt-and-braces posture homestead_machines_auto_feeds_check already takes
-- for the Feed Silo's daily allowance.
alter table public.homestead_units
  drop constraint if exists homestead_units_care_bonus_check;

alter table public.homestead_units
  add constraint homestead_units_care_bonus_check
  check (care_bonus >= 0 and care_bonus <= 2);

-- CARE_STREAK_CAP is 30, same reasoning.
alter table public.homestead_units
  drop constraint if exists homestead_units_care_streak_check;

alter table public.homestead_units
  add constraint homestead_units_care_streak_check
  check (care_streak >= 0 and care_streak <= 30);

comment on column public.homestead_units.cared_on is
  'UTC day this animal was last tended (lib/stackacres/barn.ts). Null before a first tend. One tend per animal per day; the service refuses a second.';
comment on column public.homestead_units.care_streak is
  'Consecutive UTC days tended, capped at 30. Derived forward on each tend from cared_on, never by a background job.';
comment on column public.homestead_units.care_bonus is
  'Extra produce care has added to the CURRENT cycle, capped at 2. Reset to 0 when the cycle restarts. Separate from feed_bonus so the care cap can be enforced without capping the Spinach bonus.';

-- The Barn, a twelfth machine kind.
alter table public.homestead_machines
  drop constraint homestead_machines_kind_check;

alter table public.homestead_machines
  add constraint homestead_machines_kind_check
  check (kind in (
    'mill', 'dairy', 'loom', 'vat', 'oven', 'stew_pot', 'counter', 'feed_silo', 'cellar', 'farm_kitchen',
    'smelter', 'barn'
  ));

-- MACHINE_CAP grew 11 -> 12 with the Barn (lib/stackacres/machines.ts), still
-- one of each kind. Kept in step with that constant by hand.
create or replace function public.homestead_machines_enforce_cap()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  existing integer;
begin
  perform pg_advisory_xact_lock(hashtext(new.profile_id::text || ':machines'));

  select count(*) into existing
  from public.homestead_machines
  where profile_id = new.profile_id;

  if existing >= 12 then
    raise exception 'StackAcres machine cap reached: % already placed', existing
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.homestead_machines_enforce_cap() is
  'Gates how many machines one player may place at once (12, one of each kind: mill, dairy, loom, vat, oven, stew_pot, counter, feed_silo, cellar, farm_kitchen, smelter, barn). Fires only on insert.';

revoke execute on function public.homestead_machines_enforce_cap() from public, anon, authenticated;

-- NO NEW TABLE FOR RAY'S CARE GIFTS. Which rungs of CARE_GIFT_LADDER a farm
-- has claimed is three one-shot flags, and homestead_secret_ledger
-- (20260905040815) is already the free-form per-player flag counter its own
-- header says it is -- "a real collectible and two marker/flag keys that are
-- not collectibles at all all fit one non-negative counter". The claim is an
-- atomic +1 through adjust_homestead_secret_ledger whose returned quantity is
-- 1 exactly once, so two tabs tending at the same instant cannot both be
-- handed the same sack. See `claimCareGiftRung` in
-- lib/server/stackacres-service.ts.

-- The Barn's capacity bonus has to be real in the DATABASE, not just in the
-- service, because homestead_units_enforce_stock_shape is the actual guard on
-- stocking an animal -- the service's own check is the friendly error message
-- in front of it. Without this half, a Barn farm would be told it had room and
-- then refused by the trigger.
--
-- BARN_CAPACITY_BONUS in lib/stackacres/barn.ts is 2, and STACKACRES_MAX_EXTRA_CAP
-- (3 purchased slots) is untouched: the Barn's 2 sit OUTSIDE that ceiling, which
-- is why this is a separate term rather than an addition to extra_slots. Kept in
-- step with those constants by hand, the same way MACHINE_CAP already is.
create or replace function public.homestead_units_enforce_stock_shape()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  yield_ceiling integer;
  occupied_count integer;
  v_extra_slots integer;
  v_barn_slots integer;
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

  select case when exists (
    select 1 from public.homestead_machines
    where profile_id = new.profile_id and kind = 'barn'
  ) then 2 else 0 end into v_barn_slots;

  cap := 3 + v_extra_slots + v_barn_slots;

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
  'Gates what may be STOCKED: a yield ceiling per stock kind, plus a cap (3 + purchased homestead_capacity + 2 more if a Barn is placed, counting working AND mucked units as occupying a slot) that applies only to livestock -- hen/pig/cattle. Crops are uncapped. Fires only on insert, so it can never block a collection, a feed, a clear, or a permanent unit''s restart.';
