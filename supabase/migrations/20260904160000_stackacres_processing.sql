-- StackAcres processing: wheat, machines, Town Contracts.
--
-- A DELIBERATELY SEPARATE SUBSYSTEM FROM homestead_units. That table is
-- swept wholesale into a single Gold payout by harvest_stackacres (the
-- application function `harvestStackAcres`) with no per-row opt-out -- see
-- lib/stackacres/machine-items.ts's header. Wheat must never be reachable
-- from that sweep, so it grows in its own table with its own guarded
-- collect, crediting an inventory rather than Gold.
--
-- THE ONLY DOOR BACK TO GOLD HERE is `fulfillStackAcresTownContract`
-- (lib/server/stackacres-service.ts), which reserves against the SAME
-- `STACKACRES_GOLD_CEILING` a harvest does, through the same
-- `reserve_homestead_exchange`/`release_homestead_exchange` pair from
-- 20260903130000/20260904150000. Nothing added here moves Gold on its own.
--
-- Every cap here (three wheat plots, two machines) is enforced twice, the
-- same posture homestead_units already takes: the service checks it ahead of
-- the debit for a clean 409, and a BEFORE INSERT, advisory-locked trigger is
-- the real guard a race cannot get past. See
-- homestead_units_enforce_stock_shape for why BEFORE INSERT is enough (there
-- is no "row turns working" UPDATE to gate the way stocking a plot once was).

/* -------------------------------------------------------------------- */
/* Wheat                                                                 */
/* -------------------------------------------------------------------- */

create table public.homestead_wheat_plots (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null,
  ready_at timestamptz not null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now()
);

comment on table public.homestead_wheat_plots is
  'Wheat growing toward a Mill, never toward Gold. Collecting a ripe row deletes it and credits homestead_processing_inventory -- see lib/server/stackacres-service.ts''s workStackAcres. Service-role only.';

create index homestead_wheat_plots_profile_idx
  on public.homestead_wheat_plots(profile_id);

alter table public.homestead_wheat_plots enable row level security;
revoke all on public.homestead_wheat_plots from anon, authenticated;

create or replace function public.homestead_wheat_plots_enforce_cap()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  existing integer;
begin
  perform pg_advisory_xact_lock(hashtext(new.profile_id::text || ':wheat'));

  select count(*) into existing
  from public.homestead_wheat_plots
  where profile_id = new.profile_id;

  -- Kept in step with lib/stackacres/wheat-plot.ts's WHEAT_PLOT_CAP by hand,
  -- the same duplication homestead_units_enforce_stock_shape's yield_ceiling
  -- already accepts: a trigger cannot import a TypeScript module, and a
  -- retune that moves one without the other turns a permitted sow into a 500
  -- instead of a clean 400.
  if existing >= 3 then
    raise exception 'StackAcres wheat cap reached: % plots already growing', existing
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.homestead_wheat_plots_enforce_cap() is
  'Gates how many wheat plots one player may sow at once (3). Fires only on insert, matching homestead_units_enforce_stock_shape.';

revoke execute on function public.homestead_wheat_plots_enforce_cap() from public, anon, authenticated;

create trigger homestead_wheat_plots_cap
  before insert on public.homestead_wheat_plots
  for each row
  execute function public.homestead_wheat_plots_enforce_cap();

/* -------------------------------------------------------------------- */
/* Inventory: what a wheat plot's harvest and a Mill's output sit as     */
/* -------------------------------------------------------------------- */

create table public.homestead_processing_inventory (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item text not null check (item in ('wheat', 'flour')),
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, item)
);

comment on table public.homestead_processing_inventory is
  'Processing-track item quantities (lib/stackacres/machine-items.ts). Never Gold-valued directly -- the only door back to Gold is a fulfilled homestead_contracts row. Service-role only.';

alter table public.homestead_processing_inventory enable row level security;
revoke all on public.homestead_processing_inventory from anon, authenticated;

create or replace function public.adjust_homestead_processing_inventory(
  p_profile_id uuid,
  p_item text,
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
  insert into public.homestead_processing_inventory as inv (profile_id, item, quantity)
  values (p_profile_id, p_item, greatest(p_delta, 0))
  on conflict (profile_id, item) do update
    set quantity = inv.quantity + p_delta,
        updated_at = now()
  returning inv.quantity into next_quantity;

  return next_quantity;
end;
$$;

comment on function public.adjust_homestead_processing_inventory(uuid, text, integer) is
  'Moves one player''s quantity of one processing item atomically. Raises 23514 (from quantity''s own check) rather than going negative; callers treat that as a refusal or a lost race, same contract adjust_homestead_feed already carries.';

-- `public` is load-bearing and not redundant -- see release_homestead_exchange
-- (20260904150000)''s own comment on why omitting it is a silent no-op.
revoke execute on function public.adjust_homestead_processing_inventory(uuid, text, integer)
  from public, anon, authenticated;

/* -------------------------------------------------------------------- */
/* Machines                                                              */
/* -------------------------------------------------------------------- */

create table public.homestead_machines (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('mill')),
  status text not null default 'idle' check (status in ('idle', 'working')),
  started_at timestamptz,
  ready_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  constraint homestead_machines_run_matches_status check (
    (status = 'working') = (started_at is not null and ready_at is not null)
  )
);

comment on table public.homestead_machines is
  'A processing building. Placed with Gold (a sink), never sold back. Its run is guarded by version + status, the same shape homestead_units uses. Service-role only.';

create index homestead_machines_profile_idx
  on public.homestead_machines(profile_id);

alter table public.homestead_machines enable row level security;
revoke all on public.homestead_machines from anon, authenticated;

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
  -- reasoning as homestead_wheat_plots_enforce_cap above.
  if existing >= 2 then
    raise exception 'StackAcres machine cap reached: % already placed', existing
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.homestead_machines_enforce_cap() is
  'Gates how many machines one player may place at once (2). Fires only on insert.';

revoke execute on function public.homestead_machines_enforce_cap() from public, anon, authenticated;

create trigger homestead_machines_cap
  before insert on public.homestead_machines
  for each row
  execute function public.homestead_machines_enforce_cap();

/* -------------------------------------------------------------------- */
/* Town Contracts                                                        */
/* -------------------------------------------------------------------- */

create table public.homestead_contracts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item text not null check (item in ('flour')),
  quantity integer not null check (quantity > 0),
  gold_reward integer not null check (gold_reward >= 0),
  influence_reward integer not null check (influence_reward >= 0),
  status text not null default 'open' check (status in ('open', 'fulfilled')),
  created_at timestamptz not null default now()
);

comment on table public.homestead_contracts is
  'A town request for processed goods. Gold paid on fulfilment reserves against STACKACRES_GOLD_CEILING exactly like a harvest -- see fulfillStackAcresTownContract in lib/server/stackacres-service.ts. Service-role only.';

create index homestead_contracts_profile_idx
  on public.homestead_contracts(profile_id);

-- ONE OPEN CONTRACT PER PLAYER, enforced here rather than only in
-- application code -- see lib/stackacres/contracts.ts's header for why. A
-- partial unique index is the real guard against two racing tabs both
-- posting one; createStackAcresContract in lib/server/stackacres-store.ts
-- treats the resulting 23505 exactly like a lost race.
create unique index homestead_contracts_one_open_per_profile
  on public.homestead_contracts(profile_id)
  where status = 'open';

alter table public.homestead_contracts enable row level security;
revoke all on public.homestead_contracts from anon, authenticated;

/* -------------------------------------------------------------------- */
/* Town Influence                                                        */
/* -------------------------------------------------------------------- */

create table public.homestead_town_influence (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  influence bigint not null default 0 check (influence >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.homestead_town_influence is
  'Progression earned from fulfilled Town Contracts. Additive only -- there is no spend path, unlike every Gold table here. Service-role only.';

alter table public.homestead_town_influence enable row level security;
revoke all on public.homestead_town_influence from anon, authenticated;

create or replace function public.adjust_homestead_influence(
  p_profile_id uuid,
  p_delta integer
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  next_influence bigint;
begin
  if p_delta <= 0 then
    select influence into next_influence
    from public.homestead_town_influence
    where profile_id = p_profile_id;
    return coalesce(next_influence, 0);
  end if;

  insert into public.homestead_town_influence as inf (profile_id, influence)
  values (p_profile_id, p_delta)
  on conflict (profile_id) do update
    set influence = inf.influence + p_delta,
        updated_at = now()
  returning inf.influence into next_influence;

  return next_influence;
end;
$$;

comment on function public.adjust_homestead_influence(uuid, integer) is
  'Adds to a player''s Town Influence atomically. Additive only, mirroring the currency''s own shape -- see homestead_town_influence.';

-- `public` is load-bearing and not redundant -- see release_homestead_exchange
-- (20260904150000)''s own comment on why omitting it is a silent no-op.
revoke execute on function public.adjust_homestead_influence(uuid, integer)
  from public, anon, authenticated;
