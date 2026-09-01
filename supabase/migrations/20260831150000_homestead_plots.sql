-- The StackChips Homestead: an idle farm of staked crops and livestock.
--
-- One row per owned plot (lib/server/homestead-store.ts's twin). A plot carries
-- at most one working crop or pen; stocking is an UPDATE empty -> working that
-- debits first (rule 1 in lib/server/homestead-service.ts), and collecting is a
-- single guarded UPDATE working -> empty|mucked whose version match is the
-- settlement idempotency key that makes a ready plot pay exactly once under a
-- double-tap, a retry, or two tabs. `payout` and `ready_at` are snapshotted
-- from lib/homestead/catalogue.ts at stocking and never re-read at collection,
-- the same rule StoredWordStackRound.wagerLadder states: a retune must not
-- change what an already-stocked plot pays.
--
-- Two pieces of state here are NOT derived from timestamps, and both are that
-- way for a reason:
--
--   last_fed_at   Feeding pushes ready_at forward by however long the animal
--                 spent hungry, so the clock genuinely stops rather than the
--                 UI pretending it did. That means readiness cannot be a pure
--                 function of started_at, and the row has to remember the last
--                 feed.
--   status/muck   The 20% maintenance roll is decided ONCE by the server
--                 inside the guarded collection write and stored. Rolled on
--                 read it would land differently on every refetch and a player
--                 could reroll muck by pulling to refresh.

create table public.homestead_plots (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  plot_index int not null check (plot_index between 1 and 16),
  status text not null default 'empty' check (status in ('empty', 'working', 'mucked')),
  stock text check (stock in ('sprout', 'cash_crop', 'hen', 'pig', 'cattle')),
  -- Already debited by the time this is set (rule 1). Stored, not derived, so
  -- the ledger records exactly what was staked.
  stake integer check (stake > 0),
  -- Snapshotted at stocking; the single credit at collection is exactly this.
  payout integer check (payout > 0),
  started_at timestamptz,
  -- Excludes time spent hungry: feeding pushes this forward.
  ready_at timestamptz,
  -- Livestock only; null for crops, which do not eat.
  last_fed_at timestamptz,
  -- What clearing this plot costs while mucked. Snapshotted from the tier that
  -- was working when it mucked, for the same reason payout is.
  muck_fee integer check (muck_fee > 0),
  -- Optimistic concurrency, same contract as ante_up_attempts.version: every
  -- mutation is an UPDATE ... where version = <the one just read>, and the
  -- collection write is the one that pays.
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  -- True row invariants, safe as CHECKs precisely because every write keeps
  -- them true. The *tunable* rules live in the trigger below instead -- see
  -- that comment for why.
  constraint homestead_plots_stock_matches_status check (
    (status = 'working') = (
      stock is not null and stake is not null and payout is not null
      and started_at is not null and ready_at is not null
    )
  ),
  constraint homestead_plots_muck_fee_matches_status check (
    (status = 'mucked') = (muck_fee is not null)
  )
);

comment on table public.homestead_plots is
  'One StackChips Homestead plot per row. A working plot''s stake is already debited; collection credits the snapshotted payout exactly once, guarded by version. Service-role only.';

comment on column public.homestead_plots.payout is
  'Snapshotted from lib/homestead/catalogue.ts at stocking, never re-read at collection: a retune must not change what an already-stocked plot pays.';

comment on column public.homestead_plots.ready_at is
  'Excludes time spent hungry. Feeding pushes this forward by the hungry interval, so a starving animal genuinely stops progressing rather than the UI pretending it has.';

-- One row per (player, tile); lib/server/homestead-store.ts catches 23505 off
-- this rather than read-first checking, so a double-clicked purchase refunds
-- instead of charging twice.
create unique index homestead_plots_one_row_per_plot
  on public.homestead_plots(profile_id, plot_index);

-- Both cap counts and the farm read filter on this.
create index homestead_plots_working_idx
  on public.homestead_plots(profile_id)
  where status = 'working';

alter table public.homestead_plots enable row level security;
revoke all on public.homestead_plots from anon, authenticated;

-- Feed is a per-player consumable, not a per-plot one: you buy shipments and
-- spend servings across the whole farm. One row per player, created on first
-- purchase.
create table public.homestead_feed (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  servings integer not null default 0 check (servings >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.homestead_feed is
  'Feed servings held by a player, spent one per feeding. Service-role only.';

alter table public.homestead_feed enable row level security;
revoke all on public.homestead_feed from anon, authenticated;

-- Feed moves through a row-locking RPC, never a read-then-write, for the same
-- reason credit_gold and spend_gold do: two tabs feeding at once must not both
-- see the same balance and both spend from it. The check constraint on
-- servings is what makes overspending fail loudly (23514) rather than
-- silently going negative, and the store turns that into a lost race.
create or replace function public.adjust_homestead_feed(p_profile_id uuid, p_delta integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_servings integer;
begin
  insert into public.homestead_feed as f (profile_id, servings)
  values (p_profile_id, greatest(p_delta, 0))
  on conflict (profile_id) do update
    set servings = f.servings + p_delta,
        updated_at = now()
  returning f.servings into next_servings;

  return next_servings;
end;
$$;

comment on function public.adjust_homestead_feed(uuid, integer) is
  'Moves a player''s feed balance atomically. Raises 23514 from the servings check rather than going negative; callers treat that as a lost race.';

revoke all on function public.adjust_homestead_feed(uuid, integer) from anon, authenticated;

-- WHY A TRIGGER AND NOT CHECK CONSTRAINTS, for the tunable rules
--
-- Same reasoning as ante_up_attempts_enforce_wager_ceiling, which learned it
-- the hard way: a CHECK re-evaluates on every UPDATE, and settlement here is
-- an UPDATE (the collection). A payout ceiling as a CHECK would, after a
-- retune lowered it, make an in-flight plot stocked under the old numbers
-- throw on its own collection: unsettleable forever, stake already debited. A
-- BEFORE trigger that only fires when a plot is being STOCKED (new.status =
-- 'working') says what is meant -- a plot may not be stocked outside the
-- current tuning -- and cannot interfere with collecting one that already
-- exists, because a collection writes status 'empty' or 'mucked' and never
-- trips it.
--
-- The same trigger enforces the two caps, under an advisory lock so two racing
-- stockings cannot both pass the count (the pattern
-- admob_ssv_receipts_daily_cap established). Crops and livestock are counted
-- separately, matching HOMESTEAD_FIELD_CAP and HOMESTEAD_PEN_CAP.

create or replace function public.homestead_plots_enforce_stock_shape()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  payout_ceiling integer;
  is_animal boolean;
  working_count integer;
  cap integer;
begin
  -- Keep these in step with lib/homestead/catalogue.ts. Duplicated on purpose
  -- -- a trigger cannot import a TypeScript module -- and a retune that moves
  -- one without the other turns a permitted stocking into a 500 from the
  -- database instead of a clean 400 from the service.
  payout_ceiling := case new.stock
    when 'sprout' then 525
    when 'cash_crop' then 4240
    when 'hen' then 1050
    when 'pig' then 10600
    when 'cattle' then 52500
    -- Anything not listed yields NULL and is left alone, fail-open on
    -- purpose: new stock belongs in catalogue.ts first and here second.
    else null
  end;

  if payout_ceiling is not null and new.payout > payout_ceiling then
    raise exception
      'Homestead payout % exceeds the ceiling of % for %',
      new.payout, payout_ceiling, new.stock
      using errcode = 'check_violation';
  end if;

  is_animal := new.stock in ('hen', 'pig', 'cattle');
  cap := 3;

  -- Serialize this player's stockings so the count below cannot be raced past.
  perform pg_advisory_xact_lock(hashtext(new.profile_id::text));

  select count(*) into working_count
  from public.homestead_plots
  where profile_id = new.profile_id
    and status = 'working'
    and (stock in ('hen', 'pig', 'cattle')) = is_animal
    and id <> new.id;

  if working_count >= cap then
    raise exception
      'Homestead cap reached: % already working', working_count
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.homestead_plots_enforce_stock_shape() is
  'Gates what may be STOCKED (payout ceiling per stock type, separate crop and livestock caps). Mirrors lib/homestead/catalogue.ts. Fires only when a row turns working, so it can never block a collection; see the migration that added it for why CHECKs would brick in-flight plots.';

drop trigger if exists homestead_plots_stock_shape on public.homestead_plots;
create trigger homestead_plots_stock_shape
  before insert or update on public.homestead_plots
  for each row
  when (new.status = 'working')
  execute function public.homestead_plots_enforce_stock_shape();

-- The economy ledger: every settled collection, append-only. The Homestead is
-- a guaranteed win, so how much this faucet pours is a number the economy
-- dashboards must be able to answer without archaeology. Written best-effort
-- after the credit (a ledger failure never voids a settled collection).

create table public.homestead_harvests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  plot_index int not null check (plot_index between 1 and 16),
  stock text not null check (stock in ('sprout', 'cash_crop', 'hen', 'pig', 'cattle')),
  stake integer not null check (stake > 0),
  payout integer not null check (payout > 0),
  started_at timestamptz not null,
  collected_at timestamptz not null default now()
);

comment on table public.homestead_harvests is
  'Append-only record of settled StackChips Homestead collections, for economy telemetry. Service-role only.';

create index homestead_harvests_profile_recent_idx
  on public.homestead_harvests(profile_id, collected_at desc);

alter table public.homestead_harvests enable row level security;
revoke all on public.homestead_harvests from anon, authenticated;
