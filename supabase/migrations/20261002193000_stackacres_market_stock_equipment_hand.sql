-- Market livestock, farm equipment and the hired hand.
--
-- Hogs and steers are bought young, fattened and shipped to the sale barn, so
-- the stock lists learn two new names. Their yield ceilings are the base
-- weights in lib/stackacres/catalogue.ts; feed adds weight through feed_bonus,
-- never through yield_quantity.

alter table public.homestead_units drop constraint homestead_units_stock_check;
alter table public.homestead_units add constraint homestead_units_stock_check check (stock = any (array[
  'onion', 'potato', 'carrot', 'cabbage', 'pepper', 'tomato', 'corn', 'eggplant', 'bell_pepper',
  'broccoli', 'celery', 'green_bean', 'lettuce', 'radish', 'spinach', 'wheat',
  'hen', 'pig', 'cattle', 'hog', 'steer'
]));

alter table public.homestead_capacity drop constraint homestead_capacity_stock_check;
alter table public.homestead_capacity add constraint homestead_capacity_stock_check check (stock = any (array[
  'onion', 'potato', 'carrot', 'cabbage', 'pepper', 'tomato', 'corn', 'eggplant', 'bell_pepper',
  'broccoli', 'celery', 'green_bean', 'lettuce', 'radish', 'spinach', 'wheat',
  'hen', 'pig', 'cattle', 'hog', 'steer'
]));

alter table public.homestead_harvests drop constraint homestead_harvests_stock_check;
alter table public.homestead_harvests add constraint homestead_harvests_stock_check check (stock = any (array[
  'sprout', 'cash_crop', 'hen', 'pig', 'cattle', 'hog', 'steer'
]));

create or replace function public.homestead_units_enforce_stock_shape()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
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
    when 'hog' then 6
    when 'steer' then 13
    else null
  end;

  if yield_ceiling is not null and new.yield_quantity > yield_ceiling then
    raise exception
      'StackAcres yield % exceeds the ceiling of % for %',
      new.yield_quantity, yield_ceiling, new.stock
      using errcode = 'check_violation';
  end if;

  if new.stock not in ('hen', 'pig', 'cattle', 'hog', 'steer') then
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
$function$;

-- Machines a player owns outright, like the tractor. Same shape as
-- homestead_cutter: the primary key is the settlement guard, so the service
-- debits first, inserts with ON CONFLICT DO NOTHING and refunds a write that
-- lands nothing.
create table if not exists public.homestead_equipment (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('tractor', 'combine')),
  bought_at timestamptz not null default now(),
  primary key (profile_id, kind)
);

comment on table public.homestead_equipment is
  'StackAcres farm equipment a player owns (tractor, combine). Debit first, refund if the insert lands nothing. Service-role only.';

alter table public.homestead_equipment enable row level security;
revoke all on public.homestead_equipment from public, anon, authenticated;

-- The one hired hand a farm can keep. paid_through_day is the last game day
-- the wage covers; the work pass charges at most one day at a time and moves
-- it forward under the version guard. An unpaid wage deletes the row.
create table if not exists public.homestead_hired_hand (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  paid_through_day bigint not null,
  chores_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  hired_at timestamptz not null default now()
);

comment on table public.homestead_hired_hand is
  'StackAcres hired hand: who, and the last game day their wage covers. Version-guarded writes. Service-role only.';

alter table public.homestead_hired_hand enable row level security;
revoke all on public.homestead_hired_hand from public, anon, authenticated;
