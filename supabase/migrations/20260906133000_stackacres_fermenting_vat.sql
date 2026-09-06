-- StackAcres: the Fermenting Vat, a fourth processing building.
--
-- Extends 20260904160000_stackacres_processing.sql /
-- 20260904170000_stackacres_recipes.sql rather than replacing either.
--
-- WHY THIS IS A NEW TABLE AND NOT MORE `homestead_machines` COLUMNS. A Mill's
-- run is one flat span: started_at/ready_at/recipe_id/units_processing
-- together describe the whole batch, and collecting it clears all four at
-- once. The Vat's batch does not work that way -- it is legal to collect at
-- three different points (Aged/Well-Aged/Artisan-Aged), each paying more
-- than the last, and what it pays is a function of exactly how long it has
-- been sealed, not a single ready_at boolean. That needs its own locked
-- record, `homestead_vat_manifests`, one per vat, deleted the moment it is
-- collected -- the same "guarded delete, not an update back to idle" shape
-- `homestead_wheat_plots` already uses for a single-use timer.
--
-- THE ONLY DOOR BACK TO GOLD HERE reserves against the SAME
-- `STACKACRES_GOLD_CEILING` a harvest and a fulfilled Town Contract do, via
-- the same `reserve_homestead_exchange`/`release_homestead_exchange` pair
-- from 20260903130000/20260904150000 -- see collectStackAcresVat in
-- lib/server/stackacres-service.ts. Nothing added here moves Gold on its own;
-- this migration adds no new RPC that touches homestead_exchanges at all.

/* -------------------------------------------------------------------- */
/* 1. Machines: a fourth kind, and a cap that grows with it               */
/* -------------------------------------------------------------------- */

alter table public.homestead_machines
  drop constraint homestead_machines_kind_check;

alter table public.homestead_machines
  add constraint homestead_machines_kind_check
  check (kind in ('mill', 'dairy', 'loom', 'vat'));

-- MACHINE_CAP grew 3 -> 4 alongside the fourth kind (lib/stackacres/
-- machines.ts), for the same reason the cap has always tracked the number of
-- kinds rather than staying fixed: the point is "the whole ladder", not "at
-- most three of anything". Kept in step with that constant by hand, same
-- reasoning homestead_wheat_plots_enforce_cap's own comment gives.
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

  if existing >= 4 then
    raise exception 'StackAcres machine cap reached: % already placed', existing
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.homestead_machines_enforce_cap() is
  'Gates how many machines one player may place at once (4, one of each kind: mill, dairy, loom, vat). Fires only on insert.';

revoke execute on function public.homestead_machines_enforce_cap() from public, anon, authenticated;

/* -------------------------------------------------------------------- */
/* 2. The Vat's own locked record                                        */
/* -------------------------------------------------------------------- */

create table public.homestead_vat_manifests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  machine_id uuid not null references public.homestead_machines(id) on delete cascade,
  -- Cheese only, today -- mirrors lib/stackacres/aging.ts's VAT_INPUT_ITEM.
  -- Widening this ladder later is exactly the same one-line constraint
  -- change 20260904170000 made to homestead_processing_inventory's own item
  -- check when the Dairy and the Loom were added.
  item text not null check (item in ('cheese')),
  quantity integer not null check (quantity > 0),
  -- Gold value of the batch at 1x, snapshotted the moment it was sealed. A
  -- retune of recipeRawGoldValue("cheese") after this row is written must
  -- never change what this exact batch pays -- see aging.ts's header, and
  -- the identical rule homestead_machines.recipe_id/units_processing already
  -- states for a Mill's run.
  base_gold_value integer not null check (base_gold_value >= 0),
  sealed_at timestamptz not null,
  -- The earliest instant this manifest may be collected at all (sealed_at +
  -- the first aging tier's duration). Higher tiers are derived in
  -- application code from sealed_at at read time -- this column exists only
  -- because it is the one thing the guarded collect below can put in a WHERE
  -- clause, the same role ready_at plays for a wheat plot or a Mill run.
  ready_at timestamptz not null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  constraint homestead_vat_manifests_ready_after_sealed check (ready_at >= sealed_at)
);

comment on table public.homestead_vat_manifests is
  'What is currently locked inside a Fermenting Vat. One row per active seal, deleted on collect -- see collectStackAcresVat in lib/server/stackacres-service.ts. Never Gold-valued until collection, which pays through the same daily ceiling a Town Contract does. Service-role only.';

-- ONE SEAL PER VAT. A player has at most one vat machine (homestead_machines_
-- one_per_kind), so this is also "one active seal per player" in practice,
-- but keying it on machine_id rather than profile_id is what makes a second
-- vat (if the ladder ever grows past one) safe by construction rather than
-- by a second unique index someone has to remember to add.
create unique index homestead_vat_manifests_one_per_machine
  on public.homestead_vat_manifests(machine_id);

create index homestead_vat_manifests_profile_idx
  on public.homestead_vat_manifests(profile_id);

alter table public.homestead_vat_manifests enable row level security;
revoke all on public.homestead_vat_manifests from anon, authenticated;

/* -------------------------------------------------------------------- */
/* 3. Sealing the vat: an async transaction, input debit + lock, one shot */
/* -------------------------------------------------------------------- */

-- Runs the whole seal as one transaction: the raw input leaves
-- homestead_processing_inventory under a row lock (the identical guard
-- process_homestead_recipe's own debit uses, so two taps racing to seal the
-- same vat cannot both spend the same cheese) and the manifest is written in
-- the same commit. If either half fails, both roll back -- there is no state
-- where cheese is gone and nothing is locked in the vat, which is the
-- failure mode a debit-then-insert pair (two separate calls) would risk.
create or replace function public.seal_homestead_vat(
  p_profile_id uuid,
  p_machine_id uuid,
  p_item text,
  p_quantity integer,
  p_base_gold_value integer,
  p_sealed_at timestamptz,
  p_ready_at timestamptz
)
returns public.homestead_vat_manifests
language plpgsql
security definer
set search_path = public
as $$
declare
  input_remaining integer;
  manifest public.homestead_vat_manifests;
begin
  if p_quantity <= 0 then
    raise exception 'seal_homestead_vat needs a positive quantity'
      using errcode = '22023';
  end if;

  -- The debit's sufficiency check rides inside the UPDATE's own WHERE
  -- clause, under the row lock that clause takes -- the same reasoning
  -- process_homestead_recipe's header gives for why this cannot be a
  -- SELECT-then-UPDATE pair.
  update public.homestead_processing_inventory
     set quantity = quantity - p_quantity,
         updated_at = now()
   where profile_id = p_profile_id
     and item = p_item
     and quantity >= p_quantity
  returning quantity into input_remaining;

  -- Not enough on hand. Nothing has been written; the caller treats a null
  -- return exactly like adjust_homestead_processing_inventory's own null --
  -- a refusal or a lost race, never a successful seal.
  if input_remaining is null then
    return null;
  end if;

  -- The lock, in the same transaction as the debit above. A duplicate
  -- attempt while a seal is already active hits
  -- homestead_vat_manifests_one_per_machine (23505); the caller treats that
  -- exactly like a lost race and refunds the debit it just made, the same
  -- pattern createStackAcresContract already follows for its own partial
  -- unique index.
  insert into public.homestead_vat_manifests
    (profile_id, machine_id, item, quantity, base_gold_value, sealed_at, ready_at, version)
  values
    (p_profile_id, p_machine_id, p_item, p_quantity, p_base_gold_value, p_sealed_at, p_ready_at, 1)
  returning * into manifest;

  return manifest;
end;
$$;

comment on function public.seal_homestead_vat(uuid, uuid, text, integer, integer, timestamptz, timestamptz) is
  'Debits the raw input and locks it inside a vat manifest, atomically. Returns the new manifest row, or null when the caller did not have enough input -- null must never be treated as a successful seal. Raises 23505 (unique_violation) if the named machine already holds an active manifest; the caller treats that like a lost race and refunds the debit it attempted.';

-- `public` is load-bearing and not redundant -- see release_homestead_exchange
-- (20260904150000)'s own comment on why omitting it is a silent no-op.
revoke execute on function public.seal_homestead_vat(uuid, uuid, text, integer, integer, timestamptz, timestamptz)
  from public, anon, authenticated;
