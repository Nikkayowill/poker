-- The Homestead's bag and its currency.
--
-- Phase 2 splits the old loop in half. Collecting a plot used to credit Gold
-- straight into the profile; now it yields produce into an inventory, and
-- turning that produce into money is a separate act at the supply store. The
-- money it turns into is BUSHELS, the farm's own currency, which never leaves
-- the Homestead -- Gold touches the farm only when buying acreage, and will
-- leave it only through the daily exchange window phase 3 adds.
--
-- ONE TABLE for produce AND currency, deliberately. They are the same
-- primitive: a non-negative per-player counter that must move atomically. The
-- alternative was three tables and three SECURITY DEFINER functions, and the
-- EXECUTE grant on exactly this kind of function has shipped wrong twice here
-- (see 20260901130000 and 20260813170000). One function is one grant to get
-- right. `item_id` is free-form text on purpose, the same call
-- ante_up_attempts.game makes: phase 4 and 5 add crafted goods, and none of
-- them should need a migration.
--
-- homestead_feed is deliberately left alone rather than folded in here. It
-- works, it is already revoked correctly, and its own tests pass; consolidating
-- an empty table for tidiness is not worth a second destructive DDL on a
-- feature that is live behind a gate.

create table public.homestead_inventory (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, item_id)
);

comment on table public.homestead_inventory is
  'Produce a player is holding, plus their Bushels balance under item_id ''bushels''. Bushels never convert to Gold except through the daily exchange. Service-role only.';

alter table public.homestead_inventory enable row level security;
revoke all on public.homestead_inventory from anon, authenticated;

-- Inventory moves through a row-locking RPC, never a read-then-write, for the
-- same reason credit_gold does: two tabs selling the same crate must not both
-- see the pre-sale quantity. The check constraint is what makes overspending
-- lose the race rather than go negative -- callers treat 23514 as a refusal.
create or replace function public.adjust_homestead_inventory(
  p_profile_id uuid,
  p_item_id text,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_quantity integer;
begin
  insert into public.homestead_inventory as i (profile_id, item_id, quantity)
  values (p_profile_id, p_item_id, greatest(p_delta, 0))
  on conflict (profile_id, item_id) do update
    set quantity = i.quantity + p_delta,
        updated_at = now()
  returning i.quantity into next_quantity;

  return next_quantity;
end;
$$;

comment on function public.adjust_homestead_inventory(uuid, text, integer) is
  'Moves one inventory line atomically. Raises 23514 from the quantity check rather than going negative; callers treat that as a lost race.';

-- `public` is load-bearing and not redundant: anon and authenticated inherit
-- Postgres's default PUBLIC execute grant, so revoking from the two roles alone
-- leaves the function callable on /rest/v1/rpc. This function is SECURITY
-- DEFINER and takes the profile id as a parameter rather than reading the
-- caller's session, so an anonymous caller reaching it could mint another
-- player's currency outright. All three names matter. Verify with \df+ or
-- proacl afterwards, not by re-reading this file -- a correct one has no bare
-- `=X/postgres` entry.
revoke all on function public.adjust_homestead_inventory(uuid, text, integer) from public, anon, authenticated;

-- The one-time starting grant.
--
-- INSERT ... ON CONFLICT DO NOTHING against the primary key is the whole
-- idempotency guard: a profile that already has a bushels row is never topped
-- up, even if that row sits at zero because they spent it all. That is the same
-- shape the version-guarded settlement writes use -- a lost race returns
-- nothing and nothing is paid twice -- and it is why there is deliberately no
-- second way to receive this grant.
create or replace function public.grant_homestead_starting_bushels(
  p_profile_id uuid,
  p_amount integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  granted boolean := false;
begin
  insert into public.homestead_inventory (profile_id, item_id, quantity)
  values (p_profile_id, 'bushels', greatest(p_amount, 0))
  on conflict (profile_id, item_id) do nothing;

  granted := found;
  return granted;
end;
$$;

comment on function public.grant_homestead_starting_bushels(uuid, integer) is
  'Seeds a new farm''s Bushels exactly once. Returns true only on the insert that actually created the row; the primary key is the idempotency guard.';

revoke all on function public.grant_homestead_starting_bushels(uuid, integer) from public, anon, authenticated;

-- What a plot will yield, snapshotted at planting.
--
-- The same rule StoredWordStackRound.wagerLadder states: a retune between
-- planting and harvest must not change what an already-planted plot returns.
-- The item itself is derivable from `stock`, so only the count needs storing.
--
-- Two columns change meaning with this migration, and both are safe to change
-- because homestead_plots, homestead_feed and homestead_harvests were all
-- verified EMPTY in production before it was written:
--   * `stake` now holds BUSHELS (the seed cost), not Gold.
--   * `payout` is inert from here on. Left in place rather than dropped --
--     migrations are append-only and an unused column costs nothing -- the
--     same treatment the memory-match scoring columns got.
-- Re-verify emptiness before applying this anywhere that has since been
-- played: `select count(*) from homestead_plots;` must be 0.
alter table public.homestead_plots
  add column if not exists yield_quantity integer;

comment on column public.homestead_plots.yield_quantity is
  'Units of produce this plot will yield, snapshotted at planting so a retune cannot change an in-flight plot. See lib/homestead/items.ts.';

comment on column public.homestead_plots.payout is
  'INERT since 20260901180000. Collections yield produce, not Gold. Kept because migrations are append-only.';

comment on column public.homestead_plots.stake is
  'Seed cost in BUSHELS since 20260901180000, not Gold. Gold touches the Homestead only when buying acreage.';

-- The stocking trigger's ceiling was denominated in Gold payouts (525 up to
-- 52,500) and is meaningless now that a plot yields produce. Re-pointed at the
-- thing that actually needs a database-side bound: yield_quantity. A bug that
-- inflates it mints produce, which sells for Bushels, which phase 3's exchange
-- turns into Gold -- so this is the last line before a real faucet.
--
-- Still a BEFORE trigger rather than a CHECK constraint, for the reason the
-- original migration records: a CHECK re-evaluates on every UPDATE, so one
-- over-ceiling row written before a deploy would become permanently
-- unsettleable, 500ing its page forever while the one-active-per-game index
-- blocked any new attempt.
create or replace function public.homestead_plots_enforce_stock_shape()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  yield_ceiling integer;
  is_animal boolean;
  working_count integer;
  cap integer;
begin
  -- Keep these in step with HOMESTEAD_YIELDS in lib/homestead/items.ts.
  -- Duplicated on purpose -- a trigger cannot import a TypeScript module --
  -- and a retune that moves one without the other turns a permitted planting
  -- into a 500 from the database instead of a clean 400 from the service.
  yield_ceiling := case new.stock
    when 'sprout' then 3
    when 'cash_crop' then 5
    when 'hen' then 4
    when 'pig' then 6
    when 'cattle' then 8
    -- Anything not listed yields NULL and is left alone, fail-open on
    -- purpose: new stock belongs in items.ts first and here second.
    else null
  end;

  if yield_ceiling is not null
     and new.yield_quantity is not null
     and new.yield_quantity > yield_ceiling then
    raise exception
      'Homestead yield % exceeds the ceiling of % for %',
      new.yield_quantity, yield_ceiling, new.stock
      using errcode = 'check_violation';
  end if;

  is_animal := new.stock in ('hen', 'pig', 'cattle');
  cap := 3;

  -- Serialize this player's plantings so the count below cannot be raced past.
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
  'Gates what may be PLANTED (yield ceiling per stock type, separate crop and livestock caps). Mirrors lib/homestead/items.ts. Fires only when a row turns working, so it can never block a harvest.';

revoke execute on function public.homestead_plots_enforce_stock_shape() from public, anon, authenticated;
