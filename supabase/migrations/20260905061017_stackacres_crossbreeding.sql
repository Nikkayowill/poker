-- StackAcres Crossbreeding Beds: a small planted grid where two adjacent,
-- ripe rows of different stock can mutate into a rare hybrid at harvest.
--
-- A DELIBERATELY NEW GRID, NOT A REVIVAL OF `homestead_plots`. That table
-- (20260831150000) is left in place inert, and its own successor migration
-- (20260903180000_stackacres_units) says outright: "StackAcres drops the
-- plot grid: stock is owned per unit, not per tile" -- a `homestead_units`
-- row was deliberately given no positional meaning at all, on Kayo's own
-- call that visible plot patches were not wanted. Crossbreeding is the one
-- place in StackAcres that genuinely needs 2D adjacency (two rows cannot
-- cross unless they stand next to each other), so this is its own small,
-- fixed 4x4 grid -- see lib/stackacres/crossbreeding.ts, which this table's
-- shape mirrors exactly -- and it never reads from or writes to
-- `homestead_units`/`homestead_plots`.
--
-- NOT `homestead_inventory`/`adjust_homestead_inventory` EITHER. That table
-- and RPC are a documented decade-dead leftover from the barn era, still
-- live in the database but read by nothing current (see
-- 20260904160000_stackacres_processing's own inventory-section comment,
-- which hit this exact trap once already). A hybrid's own quantity gets its
-- own table and its own RPC below, the same way
-- `homestead_processing_inventory`/`adjust_homestead_processing_inventory`
-- did for the Mill rather than reusing that dead pair.
--
-- ATOMIC HYBRIDIZATION: `harvest_stackacres_crossbreed_plot` clears the
-- harvested plot AND (on a mutation) the neighbor it crossed with, and
-- credits the one hybrid item produced, all in a single transaction --
-- `process_homestead_recipe` (20260904170000)'s own pattern, chosen over two
-- separate calls to an adjust-inventory RPC for the identical reason that
-- migration gives: a debit-then-credit pair is only as good as the second
-- call actually landing, and a real transaction cannot leave that half-done.
-- The random ROLL itself is NOT done in SQL: the server process rolls it
-- (via lib/stackacres/crossbreeding.ts's pure `resolveCrossbreedHarvest`,
-- fed a real random source) and this function's job is only to commit that
-- decision IF the two rows it names still match the state the roll was made
-- against -- see the function body for the race this guards.

create table public.stackacres_crossbreed_plots (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  row_index int not null check (row_index between 0 and 3),
  col_index int not null check (col_index between 0 and 3),
  stock text not null check (stock in ('sprout', 'cash_crop', 'hen', 'pig', 'cattle')),
  started_at timestamptz not null,
  ready_at timestamptz not null,
  -- Optimistic concurrency, same contract every other guarded row in
  -- StackAcres uses: a write is an UPDATE/DELETE ... where version = <the one
  -- just read>, and a lost race returns null/zero rows rather than paying.
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now()
);

comment on table public.stackacres_crossbreed_plots is
  'One planted Crossbreeding Bed cell. The (profile, row, col) uniqueness below is what caps a bed at 16 plots -- there is no separate cap trigger, unlike homestead_units, because the grid itself is the cap. Service-role only.';

comment on column public.stackacres_crossbreed_plots.ready_at is
  'Snapshotted from lib/stackacres/catalogue.ts''s durationMs at planting, same rule every other StackAcres timer follows: a retune must not change what an already-planted row was promised.';

-- One row per (player, cell); a double-clicked plant catches 23505 here
-- rather than needing a read-first check, the same convention
-- homestead_plots_one_row_per_plot established.
create unique index stackacres_crossbreed_plots_one_row_per_cell
  on public.stackacres_crossbreed_plots(profile_id, row_index, col_index);

create index stackacres_crossbreed_plots_profile_idx
  on public.stackacres_crossbreed_plots(profile_id);

alter table public.stackacres_crossbreed_plots enable row level security;
revoke all on public.stackacres_crossbreed_plots from anon, authenticated;

/* -------------------------------------------------------------------- */
/* The hybrid item space                                                 */
/* -------------------------------------------------------------------- */

create table public.stackacres_crossbreed_inventory (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item text not null check (
    item in ('golden_maize', 'sunroot_egg', 'candied_husk', 'marbled_down', 'tallow_wool', 'custard_curd')
  ),
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, item)
);

comment on table public.stackacres_crossbreed_inventory is
  'Hybrid item quantities bred at a Crossbreeding Bed (lib/stackacres/crossbreed-items.ts). Never Gold-valued directly and never swept by harvest_stackacres -- credited only by harvest_stackacres_crossbreed_plot below. Service-role only.';

alter table public.stackacres_crossbreed_inventory enable row level security;
revoke all on public.stackacres_crossbreed_inventory from anon, authenticated;

/* -------------------------------------------------------------------- */
/* Atomic hybridization                                                  */
/* -------------------------------------------------------------------- */

/**
 * Settles one harvest tap on a Crossbreeding Bed. The caller has already run
 * lib/stackacres/crossbreeding.ts's pure `resolveCrossbreedHarvest` against
 * its own fresh read of the grid and is reporting that decision here; this
 * function's only job is to commit it IF both rows still match the state the
 * decision was made against, never to re-derive the decision itself.
 *
 * `p_neighbor_plot_id`/`p_neighbor_version`/`p_hybrid_item`/
 * `p_hybrid_quantity` are all null together (a plain harvest, nothing
 * qualified or the roll missed) or all set together (a successful cross) --
 * enforced below, not left to the caller's discipline alone.
 *
 * Returns zero rows when the HARVESTED plot itself lost its race (wrong
 * version, already gone, or not yet ripe) -- the caller's "lost race, this
 * request already happened or was never valid" case, same as every other
 * version-guarded write in StackAcres.
 *
 * Returns one row otherwise. `neighbor_cleared` is false, and
 * `hybrid_item`/`hybrid_quantity` are null, in TWO different cases a caller
 * must treat identically (both are "no hybrid, only the tapped plot
 * cleared"): a plain harvest (no neighbor was ever named), and a mutation
 * whose NEIGHBOR lost its own race between the evaluation and this call
 * (harvested, or simply no longer ripe, in the meantime). The plot already
 * cleared above is not rolled back for that -- a player who taps a ripe row
 * gets their harvest regardless of whether the neighbor it might have
 * crossed with happened to still be there a moment later.
 */
create or replace function public.harvest_stackacres_crossbreed_plot(
  p_profile_id uuid,
  p_plot_id uuid,
  p_plot_version bigint,
  p_neighbor_plot_id uuid,
  p_neighbor_version bigint,
  p_hybrid_item text,
  p_hybrid_quantity integer
)
returns table(hybrid_item text, hybrid_quantity integer, neighbor_cleared boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  next_quantity integer;
begin
  if (p_neighbor_plot_id is null) <> (p_neighbor_version is null) then
    raise exception 'harvest_stackacres_crossbreed_plot: neighbor id and version must both be null or both be set'
      using errcode = '22023';
  end if;
  if (p_neighbor_plot_id is null) <> (p_hybrid_item is null) then
    raise exception 'harvest_stackacres_crossbreed_plot: a hybrid item requires a neighbor plot, and vice versa'
      using errcode = '22023';
  end if;
  if (p_hybrid_item is null) <> (p_hybrid_quantity is null) then
    raise exception 'harvest_stackacres_crossbreed_plot: a hybrid item and its quantity must both be null or both be set'
      using errcode = '22023';
  end if;
  if p_hybrid_quantity is not null and p_hybrid_quantity <= 0 then
    raise exception 'harvest_stackacres_crossbreed_plot needs a positive hybrid quantity'
      using errcode = '22023';
  end if;

  -- THE HARVESTED PLOT. Version AND readiness guarded in the same statement
  -- as the delete, same shape homestead_wheat_plots' own collect uses --
  -- neither is checked by a SELECT beforehand, so a race cannot read
  -- "ready" and then lose the row out from under a second statement.
  delete from public.stackacres_crossbreed_plots
   where id = p_plot_id
     and profile_id = p_profile_id
     and version = p_plot_version
     and ready_at <= now();
  if not found then
    return;
  end if;

  if p_neighbor_plot_id is null then
    hybrid_item := null;
    hybrid_quantity := null;
    neighbor_cleared := false;
    return next;
    return;
  end if;

  -- THE NEIGHBOR, same guard. Losing this race downgrades to a plain
  -- harvest of the plot already cleared above -- see this function's own
  -- doc comment for why that plot's delete is not rolled back for it.
  delete from public.stackacres_crossbreed_plots
   where id = p_neighbor_plot_id
     and profile_id = p_profile_id
     and version = p_neighbor_version
     and ready_at <= now();
  if not found then
    hybrid_item := null;
    hybrid_quantity := null;
    neighbor_cleared := false;
    return next;
    return;
  end if;

  insert into public.stackacres_crossbreed_inventory as inv (profile_id, item, quantity)
  values (p_profile_id, p_hybrid_item, p_hybrid_quantity)
  on conflict (profile_id, item) do update
    set quantity = inv.quantity + p_hybrid_quantity,
        updated_at = now()
  returning inv.quantity into next_quantity;

  hybrid_item := p_hybrid_item;
  hybrid_quantity := next_quantity;
  neighbor_cleared := true;
  return next;
end;
$$;

comment on function public.harvest_stackacres_crossbreed_plot(uuid, uuid, bigint, uuid, bigint, text, integer) is
  'Commits one already-decided harvest (see lib/server/stackacres-crossbreeding-store.ts) atomically: clears the harvested plot, and on a still-valid mutation clears its neighbor and credits the hybrid, all in one transaction. Zero rows back means the harvested plot itself lost its race.';

-- `public` is load-bearing and not redundant -- anon and authenticated
-- inherit Postgres's default PUBLIC execute grant, so revoking from the two
-- roles alone leaves this callable on /rest/v1/rpc. This exact omission has
-- shipped wrong twice already on this feature set (see
-- 20260901130000_revoke_homestead_function_execute_from_public and
-- release_homestead_exchange's own comment) -- verify with get_advisors
-- after applying, not by re-reading this file.
revoke execute on function public.harvest_stackacres_crossbreed_plot(uuid, uuid, bigint, uuid, bigint, text, integer)
  from public, anon, authenticated;
