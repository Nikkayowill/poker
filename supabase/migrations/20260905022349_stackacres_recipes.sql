-- StackAcres processing, part two: recipes, a Dairy and a Loom.
--
-- Extends 20260904160000_stackacres_processing.sql rather than replacing it.
-- Three things change shape:
--
--   1. THE ITEM SPACE GROWS from (wheat, flour) to six items. `milk` and
--      `wool` here name the SAME physical produce as the Gold track's own
--      milk and wool -- see lib/stackacres/machine-items.ts's header. There is
--      no second table and no second row for them: a ready cow settles either
--      into Gold (harvest_stackacres) or into this inventory (the `divert`
--      action), through the SAME version-guarded write on homestead_units, so
--      the two paths race for one row and exactly one wins. THIS IS NOT A NEW
--      WAY TO PRINT GOLD: diverting produce REMOVES Gold from the harvest,
--      and the only path back in is still a fulfilled contract, still
--      reserved against the same flat daily ceiling.
--
--   2. A MACHINE ROW BECOMES A QUEUE ENTRY. `recipe_id` and
--      `units_processing` are written with started_at/ready_at and cleared
--      with them, so a working machine says what it is making and how much --
--      snapshotted at start, never re-read from RECIPE_CATALOGUE at
--      collection. Same rule ante_up_attempts.multiplier and
--      homestead_units.yield_quantity already state: a retune must not change
--      what an already-running batch pays out.
--
--   3. INSTANT RECIPES GET A REAL TRANSACTION. `process_homestead_recipe`
--      does the input debit and the output credit in ONE function, so a
--      failure anywhere rolls both back. That is strictly stronger than the
--      debit-then-compensating-refund pair `workStackAcres` uses for a queued
--      run, which is only as good as the refund actually landing.
--
-- Ordering below is load-bearing: columns are added and BACKFILLED before the
-- constraint that requires them is installed. A CHECK re-evaluates on every
-- UPDATE, in-flight rows included, so a constraint added ahead of the
-- backfill would make an already-working Mill permanently uncollectable --
-- exactly the trap 20260827's ante_up wager ceiling documented.

/* -------------------------------------------------------------------- */
/* 1. The item space                                                     */
/* -------------------------------------------------------------------- */

alter table public.homestead_processing_inventory
  drop constraint homestead_processing_inventory_item_check;

alter table public.homestead_processing_inventory
  add constraint homestead_processing_inventory_item_check
  check (item in ('wheat', 'flour', 'milk', 'wool', 'cheese', 'cloth'));

comment on table public.homestead_processing_inventory is
  'Processing-track item quantities (lib/stackacres/machine-items.ts). Never Gold-valued directly -- the only door back to Gold is a fulfilled homestead_contracts row. `milk`/`wool` here are produce DIVERTED away from a harvest, not a copy of it. Service-role only.';

/* -------------------------------------------------------------------- */
/* 2. Machines: new kinds, and the queue columns                         */
/* -------------------------------------------------------------------- */

alter table public.homestead_machines
  drop constraint homestead_machines_kind_check;

alter table public.homestead_machines
  add constraint homestead_machines_kind_check
  check (kind in ('mill', 'dairy', 'loom'));

alter table public.homestead_machines
  add column if not exists recipe_id text
    check (recipe_id is null or recipe_id in ('flour', 'cheese', 'cloth')),
  add column if not exists units_processing integer not null default 0
    check (units_processing >= 0);

comment on column public.homestead_machines.recipe_id is
  'Which recipe this run is making. Snapshotted at start alongside units_processing; null while idle. Never re-read from lib/stackacres/recipes.ts at collection.';

comment on column public.homestead_machines.units_processing is
  'How many units of the recipe''s output this run yields. Zero while idle.';

-- BACKFILL BEFORE THE CONSTRAINT. Every machine that exists today is a Mill,
-- and a Mill has only ever run one recipe, so a working row is unambiguously
-- one batch of Flour. Without this the constraint below would refuse to
-- validate, and -- worse -- an already-running Mill would fail its own
-- collection UPDATE forever.
update public.homestead_machines
   set recipe_id = 'flour',
       units_processing = 1
 where status = 'working'
   and recipe_id is null;

alter table public.homestead_machines
  drop constraint homestead_machines_run_matches_status;

-- All four run columns move together or not at all. An idle machine holds no
-- run, a working one holds a complete one; there is no half-set state for a
-- collection to guess at.
alter table public.homestead_machines
  add constraint homestead_machines_run_matches_status check (
    (status = 'working') = (
      started_at is not null
      and ready_at is not null
      and recipe_id is not null
      and units_processing > 0
    )
  );

-- ONE MACHINE OF EACH KIND. The flat cap below still holds the total, but
-- this is what makes it mean "the whole ladder" rather than "three Dairies":
-- a second Dairy doubles throughput without adding a decision, and the cap is
-- meant to bound how much processing runs at once, not to be spent all on the
-- most valuable conversion. Machines are never deleted, so a plain unique
-- index is enough; createStackAcresMachine treats the resulting 23505 exactly
-- like a lost race.
create unique index homestead_machines_one_per_kind
  on public.homestead_machines(profile_id, kind);

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

  -- Kept in step with lib/stackacres/machines.ts's MACHINE_CAP by hand, same
  -- reasoning as homestead_wheat_plots_enforce_cap: a trigger cannot import a
  -- TypeScript module, and a retune that moves one without the other turns a
  -- permitted placement into a 500 instead of a clean 409.
  if existing >= 3 then
    raise exception 'StackAcres machine cap reached: % already placed', existing
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.homestead_machines_enforce_cap() is
  'Gates how many machines one player may place at once (3, one of each kind). Fires only on insert.';

revoke execute on function public.homestead_machines_enforce_cap() from public, anon, authenticated;

/* -------------------------------------------------------------------- */
/* 3. Contracts may ask for the new goods                                */
/* -------------------------------------------------------------------- */

alter table public.homestead_contracts
  drop constraint homestead_contracts_item_check;

alter table public.homestead_contracts
  add constraint homestead_contracts_item_check
  check (item in ('flour', 'cheese', 'cloth'));

/* -------------------------------------------------------------------- */
/* 4. The instant conversion, as one transaction                         */
/* -------------------------------------------------------------------- */

create or replace function public.process_homestead_recipe(
  p_profile_id uuid,
  p_input_item text,
  p_input_quantity integer,
  p_output_item text,
  p_output_quantity integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  input_remaining integer;
  output_total integer;
begin
  if p_input_quantity <= 0 or p_output_quantity <= 0 then
    raise exception 'process_homestead_recipe needs positive quantities'
      using errcode = '22023';
  end if;

  if p_input_item = p_output_item then
    raise exception 'process_homestead_recipe cannot convert an item into itself'
      using errcode = '22023';
  end if;

  -- THE NEGATIVE DELTA FIRST, and the sufficiency check rides inside the same
  -- statement rather than in a SELECT before it. `where quantity >=` takes the
  -- row lock and tests the balance atomically, so two taps arriving together
  -- cannot both read "enough" and both spend -- the second one matches no row
  -- and falls through to the null return below. A read-then-write here would
  -- be the classic double-spend, and it is the reason this is one function
  -- instead of two calls to adjust_homestead_processing_inventory.
  update public.homestead_processing_inventory
     set quantity = quantity - p_input_quantity,
         updated_at = now()
   where profile_id = p_profile_id
     and item = p_input_item
     and quantity >= p_input_quantity
  returning quantity into input_remaining;

  -- Not enough on hand (or no row at all). Nothing has been written; the
  -- caller treats null exactly like adjust_homestead_processing_inventory's
  -- null -- a refusal or a lost race, never a successful spend.
  if input_remaining is null then
    return null;
  end if;

  -- THE POSITIVE DELTA SECOND, in the same transaction. If this raises, the
  -- debit above rolls back with it: there is no state where the input is gone
  -- and the output never arrived, which is what makes this stronger than a
  -- debit followed by a compensating refund.
  insert into public.homestead_processing_inventory as inv (profile_id, item, quantity)
  values (p_profile_id, p_output_item, p_output_quantity)
  on conflict (profile_id, item) do update
    set quantity = inv.quantity + p_output_quantity,
        updated_at = now()
  returning inv.quantity into output_total;

  return output_total;
end;
$$;

comment on function public.process_homestead_recipe(uuid, text, integer, text, integer) is
  'Runs one batch of a recipe atomically: debits the raw input under a row lock, then credits the byproduct, both in one transaction. Returns the new byproduct quantity, or null when the player did not have enough input -- null must never be treated as a successful conversion. See processRecipe in lib/server/stackacres-service.ts.';

-- `public` is load-bearing and not redundant -- see release_homestead_exchange
-- (20260904150000)'s own comment on why omitting it is a silent no-op.
revoke execute on function public.process_homestead_recipe(uuid, text, integer, text, integer)
  from public, anon, authenticated;
