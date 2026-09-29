-- StackAcres drops the plot grid: stock is owned per unit, not per tile.
--
-- Kayo doesn't want visible plot patches -- select a district (already how
-- the signpost works) and the sidebar shows what you can do/buy there; buying
-- more cattle just makes more cattle appear at Ox Fields. `plot_index` was the
-- identity `homestead_plots` and half of lib/stackacres/ were built around
-- (grow timer, hunger, muck, the fence-merge/drag-to-plot rendering); this
-- migration carries the same state machine over onto a per-UNIT identity
-- instead, with no positional meaning at all.
--
-- `homestead_plots` is left in place, inert, same posture as the `payout`
-- column two migrations ago -- not dropped, just no longer written to.
-- Production held 4 real working rows at the time this was written (one
-- profile, mid-testing) and 12 empty ones; the empties need no backfill (an
-- empty plot has no successor in a model with no plots), and the 4 working
-- rows are carried into homestead_units below by a one-time INSERT ... SELECT.
-- One of those four (cattle, plot_index 7) was stocked before the pen-zoning
-- pass existed and sits on a plot whose old grid position never matched its
-- kind's district -- dropping plot_index entirely is what makes that stale
-- mismatch moot rather than something to reconcile by hand.

create table public.homestead_units (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  stock text not null check (stock in ('sprout', 'cash_crop', 'hen', 'pig', 'cattle')),
  status text not null default 'working' check (status in ('working', 'mucked')),
  -- Bushels, snapshotted at stocking (rule 3: never re-read at collection).
  stake integer not null check (stake > 0),
  yield_quantity integer not null check (yield_quantity > 0),
  started_at timestamptz not null,
  -- Excludes time spent hungry: feeding pushes this forward.
  ready_at timestamptz not null,
  -- Livestock only; null for crops, which do not eat.
  last_fed_at timestamptz,
  -- What clearing this unit costs while mucked. Null except when mucked.
  muck_fee integer check (muck_fee > 0),
  -- True when bought outright with Gold: re-sows itself at collection instead
  -- of being removed, and never mucks. See lib/server/stackacres-service.ts.
  permanent boolean not null default false,
  -- Optimistic concurrency, same contract homestead_plots.version had: every
  -- mutation is an UPDATE ... where version = <the one just read>.
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  constraint homestead_units_muck_fee_matches_status check (
    (status = 'mucked') = (muck_fee is not null)
  )
);

comment on table public.homestead_units is
  'One owned animal or crop, no plot underneath it. A working unit''s Bushel stake is already debited (non-permanent) or was paid once in Gold (permanent); collection credits produce, guarded by version. Service-role only. Successor to homestead_plots, which is left in place inert.';

comment on column public.homestead_units.yield_quantity is
  'Units of produce this yields, snapshotted at stocking so a retune cannot change an in-flight unit. See lib/stackacres/items.ts.';

comment on column public.homestead_units.ready_at is
  'Excludes time spent hungry. Feeding pushes this forward by the hungry interval, so a starving animal genuinely stops progressing rather than the UI pretending it has.';

comment on column public.homestead_units.permanent is
  'True when bought outright with Gold (lib/stackacres/market.ts). A permanent unit re-sows itself at collection instead of being removed, and never mucks. False means sown with Bushels and consumed by its own harvest -- collecting a clean one deletes the row; muck leaves it for `clear` to pay off.';

-- Every read (the client's own view, the cap count) is scoped to a profile,
-- so both indexes lead with it: this one for "everything this player owns,
-- any status" (the client view), the partial one below for the hot path that
-- actually needs counting (the trigger's cap check, working stock only).
create index homestead_units_profile_idx
  on public.homestead_units(profile_id);

create index homestead_units_working_idx
  on public.homestead_units(profile_id, stock)
  where status = 'working';

alter table public.homestead_units enable row level security;
revoke all on public.homestead_units from anon, authenticated;

-- Runs BEFORE homestead_units_stock_shape exists below, deliberately: this is
-- a straight carry-over of rows already validated once (against
-- homestead_plots's own trigger, when they were first stocked), not a fresh
-- stocking request, so it must not be re-checked against the new trigger's
-- cap/ceiling as if it were one. yield_quantity is guaranteed NOT NULL here --
-- homestead_plots_stock_matches_status already requires it for every
-- status = 'working' row (verified against the live constraint before writing
-- this), so no fallback is needed.
insert into public.homestead_units
  (profile_id, stock, status, stake, yield_quantity, started_at, ready_at, last_fed_at, permanent, version, created_at)
select profile_id, stock, 'working', stake, yield_quantity, started_at, ready_at, last_fed_at, permanent, version, created_at
from public.homestead_plots
where status = 'working';

-- Capacity: how many of one stock kind a player may have working at once,
-- above the free base of 3. Same shape as homestead_feed -- one row per
-- (player, kind), created on first purchase, moved through a row-locking RPC.
create table public.homestead_capacity (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  stock text not null check (stock in ('sprout', 'cash_crop', 'hen', 'pig', 'cattle')),
  extra_slots integer not null default 0 check (extra_slots >= 0 and extra_slots <= 3),
  updated_at timestamptz not null default now(),
  primary key (profile_id, stock)
);

comment on table public.homestead_capacity is
  'Purchased capacity above the free base of 3 working units, per stock kind. Effective cap is 3 + extra_slots, read by homestead_units_enforce_stock_shape. Service-role only.';

alter table public.homestead_capacity enable row level security;
revoke all on public.homestead_capacity from anon, authenticated;

create or replace function public.adjust_homestead_capacity(
  p_profile_id uuid,
  p_stock text,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_slots integer;
begin
  insert into public.homestead_capacity as c (profile_id, stock, extra_slots)
  values (p_profile_id, p_stock, greatest(p_delta, 0))
  on conflict (profile_id, stock) do update
    set extra_slots = c.extra_slots + p_delta,
        updated_at = now()
  returning c.extra_slots into next_slots;

  return next_slots;
end;
$$;

comment on function public.adjust_homestead_capacity(uuid, text, integer) is
  'Moves a player''s purchased capacity for one stock kind atomically. Raises 23514 (from extra_slots'' check) rather than going negative or past the 3-slot ceiling; callers treat that as a refusal or a lost race.';

-- `public` is load-bearing and not redundant -- anon and authenticated inherit
-- the default PUBLIC execute grant, so revoking from the two roles alone
-- leaves this callable on /rest/v1/rpc. This has shipped wrong twice on this
-- feature already (see 20260901130000_revoke_homestead_function_execute_from_public
-- and 20260813170000); verify with proacl after applying, not by re-reading
-- this file.
revoke all on function public.adjust_homestead_capacity(uuid, text, integer) from public, anon, authenticated;

-- WHY A BEFORE-INSERT-ONLY TRIGGER, not a CHECK and not BEFORE INSERT OR UPDATE.
--
-- A CHECK re-evaluates on every UPDATE, and settlement here (collect, feed,
-- clear) is all UPDATEs -- the same trap homestead_plots_enforce_stock_shape
-- was built to avoid. INSERT-only is enough here in a way it wasn't for
-- homestead_plots: a unit is either born working (INSERT, via `stock` or
-- `buy-stock`) or it already exists and only ever transitions between
-- working/hungry/mucked/re-sown on that same row -- there is no "plot turns
-- working" UPDATE to gate the way stocking an existing plot row was, because
-- there is no empty row waiting to be claimed. A permanent unit's restart-at-
-- collection is an UPDATE on an existing row and correctly never re-checks
-- the cap or ceiling, the same as it does today for homestead_plots.
create or replace function public.homestead_units_enforce_stock_shape()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  yield_ceiling integer;
  working_count integer;
  extra_slots integer;
  cap integer;
begin
  -- Keep in step with lib/stackacres/items.ts's STACKACRES_YIELDS. Duplicated
  -- on purpose -- a trigger cannot import a TypeScript module -- and a retune
  -- that moves one without the other turns a permitted stocking into a 500
  -- from the database instead of a clean 400 from the service.
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

  -- Serialize this player's stockings so the count below cannot be raced past.
  perform pg_advisory_xact_lock(hashtext(new.profile_id::text));

  select coalesce(max(extra_slots), 0) into extra_slots
  from public.homestead_capacity
  where profile_id = new.profile_id and stock = new.stock;

  cap := 3 + extra_slots;

  -- No `and id <> new.id` needed here, unlike homestead_plots_enforce_stock_shape:
  -- that trigger fired on UPDATE too, where the row already exists in the
  -- table under its old values and has to exclude itself. This one is
  -- INSERT-only, so `new` is not yet a row this SELECT can see at all.
  select count(*) into working_count
  from public.homestead_units
  where profile_id = new.profile_id
    and stock = new.stock
    and status = 'working';

  if working_count >= cap then
    raise exception
      'StackAcres cap reached: % of % % already working', working_count, cap, new.stock
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.homestead_units_enforce_stock_shape() is
  'Gates what may be STOCKED (yield ceiling per stock kind, cap = 3 + purchased homestead_capacity). Fires only on insert, so it can never block a collection, a feed, or a permanent unit''s restart.';

revoke execute on function public.homestead_units_enforce_stock_shape() from public, anon, authenticated;

drop trigger if exists homestead_units_stock_shape on public.homestead_units;
create trigger homestead_units_stock_shape
  before insert on public.homestead_units
  for each row
  execute function public.homestead_units_enforce_stock_shape();

-- The harvest ledger keeps recording every settled collection, but a harvest
-- no longer comes off a numbered plot. `plot_index` stays set on every row
-- already written (true history) and becomes optional for new ones; `unit_id`
-- is added alongside it for anything written from here on. No FK to
-- homestead_units: a clean (non-permanent, non-mucked) collect can delete the
-- unit row in the same request that writes this ledger entry, and the ledger
-- must survive that -- it is a record, not a live reference.
--
-- The existing `plot_index between 1 and 16` check needs no change: a CHECK
-- constraint is satisfied when its expression is true OR null, so a null
-- plot_index already passes it without touching the constraint at all
-- (confirmed against the live constraint, homestead_harvests_plot_index_check,
-- before writing this).
alter table public.homestead_harvests
  alter column plot_index drop not null,
  add column if not exists unit_id uuid;

comment on column public.homestead_harvests.plot_index is
  'Set only on rows written before 20260903180000 (the plot grid). Null on every row since -- see unit_id.';

comment on column public.homestead_harvests.unit_id is
  'The homestead_units row this harvest came off, recorded for reference only -- not a foreign key, since a clean collect can delete that row in the same request.';
