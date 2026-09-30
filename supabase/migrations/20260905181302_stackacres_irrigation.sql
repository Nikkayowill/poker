-- Irrigation pipe network: a player-built lattice that carries water from a
-- well out to the crops, watering them without a tap.
--
-- OWN TABLE, OWN RPCs. This is NOT homestead_inventory /
-- adjust_homestead_inventory -- that pair is the inert barn-era one (see
-- lib/server/stackacres-store.ts's inventory header and
-- 20260904200000_stackacres_synergy_tree.sql's own note). Pointing a new
-- feature at either would silently wire it to a dead table. The shape here
-- follows the homestead_machines precedent instead: a small per-row table,
-- a BEFORE INSERT cap trigger, service-role only.
--
-- MONEY. Placement spends Gold (a sink, like a Mill's placeCost, never
-- refunded on removal) and that debit follows the money-ordering rules in
-- lib/server/stackacres-service.ts: spent before the row exists, refunded
-- if the insert fails. HYDRATION ITSELF MOVES NO MONEY -- irrigation is
-- free, the same way watering is free. Nothing here touches gold_ledger.
--
-- DERIVED COLUMNS. mask / hydrated / distance are not authored by hand. The
-- server runs recalculatePipeConnections (lib/stackacres/irrigation.ts, a
-- pure BFS + bitmask pass) after every layout change and writes the result
-- back with sync_homestead_pipe_network in one atomic statement, so a game
-- read stays write-free (CLAUDE.md: "keep game reads write-free and
-- mutations version-checked/atomic").

create table public.homestead_pipes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  tx integer not null,
  ty integer not null,
  kind text not null check (kind in ('well', 'pipe')),
  mask smallint not null default 0 check (mask between 0 and 15),
  hydrated boolean not null default false,
  distance smallint check (distance is null or distance between 0 and 8),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  unique (profile_id, tx, ty)
);

comment on table public.homestead_pipes is
  'One irrigation tile per row, on the STACKACRES_TILE lattice (tx/ty are floor(worldX / 16), floor(worldY / 16)). kind: a well is a fluid source, a pipe carries water. mask (0..15, bit 0 N / 1 E / 2 S / 3 W), hydrated and distance (BFS steps from the nearest well, <= 8) are DERIVED -- recomputed in TypeScript by recalculatePipeConnections and written back by sync_homestead_pipe_network, never set by hand.';

alter table public.homestead_pipes enable row level security;
revoke all on public.homestead_pipes from anon, authenticated;

create index homestead_pipes_profile_idx on public.homestead_pipes (profile_id);

-- How many tiles one farm may place, and at most one well.
--
-- BEFORE INSERT only. A CHECK constraint re-runs on every UPDATE, and
-- sync_homestead_pipe_network bumps version on changed tiles every
-- recompute; a CHECK would then re-litigate the cap against rows already
-- committed and could wedge the whole layout the first time it was exceeded
-- (see 20260903180000_stackacres_units.sql's trigger note and
-- reference_stackchips_check_constraints_block_updates). An advisory xact
-- lock serialises concurrent inserts for one profile so two tabs cannot
-- both slip past the count.
create or replace function public.homestead_pipes_enforce_cap()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  tile_count integer;
  well_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('homestead_pipes:' || new.profile_id::text));

  select count(*), count(*) filter (where kind = 'well')
    into tile_count, well_count
    from public.homestead_pipes
   where profile_id = new.profile_id;

  if tile_count >= 120 then
    raise exception 'irrigation layout is full (120 tiles)'
      using errcode = 'check_violation';
  end if;

  if new.kind = 'well' and well_count >= 1 then
    raise exception 'this farm already has a well'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.homestead_pipes_enforce_cap() is
  'Gates how many irrigation tiles one farm may place (120) and how many wells (1). Fires only on insert, matching homestead_wheat_plots_enforce_cap and homestead_machines_enforce_cap.';

revoke execute on function public.homestead_pipes_enforce_cap() from public, anon, authenticated;

create trigger homestead_pipes_cap
  before insert on public.homestead_pipes
  for each row execute function public.homestead_pipes_enforce_cap();

-- Place one tile. Idempotent: re-placing the same coordinate returns the
-- existing row unchanged (the unique index makes the insert a no-op). The
-- derived columns come out at their defaults and are corrected by the
-- caller's immediately-following sync_homestead_pipe_network call.
create or replace function public.place_homestead_pipe(
  p_profile_id uuid,
  p_tx integer,
  p_ty integer,
  p_kind text
)
returns public.homestead_pipes
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out public.homestead_pipes;
begin
  if p_kind not in ('well', 'pipe') then
    raise exception 'unknown pipe kind %', p_kind using errcode = 'check_violation';
  end if;

  insert into public.homestead_pipes (profile_id, tx, ty, kind)
  values (p_profile_id, p_tx, p_ty, p_kind)
  on conflict (profile_id, tx, ty) do nothing
  returning * into row_out;

  if row_out.id is null then
    select * into row_out
      from public.homestead_pipes
     where profile_id = p_profile_id and tx = p_tx and ty = p_ty;
  end if;

  return row_out;
end;
$$;

revoke execute on function public.place_homestead_pipe(uuid, integer, integer, text)
  from public, anon, authenticated;

-- Remove one tile. Returns the number of rows deleted (0 or 1).
create or replace function public.remove_homestead_pipe(
  p_profile_id uuid,
  p_tx integer,
  p_ty integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.homestead_pipes
   where profile_id = p_profile_id and tx = p_tx and ty = p_ty;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function public.remove_homestead_pipe(uuid, integer, integer)
  from public, anon, authenticated;

-- Write the derived state (mask / hydrated / distance) for a whole layout
-- back in one statement. The caller has just run recalculatePipeConnections
-- and passes every node as { tx, ty, mask, hydrated, distance }.
--
-- Coordinates not in the payload are left alone -- they were removed in the
-- same request, or belong to another profile. version bumps only on a tile
-- whose derived triple actually moved (the `is distinct from` guard), so a
-- no-op recompute is a no-op write.
create or replace function public.sync_homestead_pipe_network(
  p_profile_id uuid,
  p_nodes jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.homestead_pipes as p
     set mask = n.mask,
         hydrated = n.hydrated,
         distance = n.distance,
         version = p.version + 1
    from jsonb_to_recordset(coalesce(p_nodes, '[]'::jsonb))
      as n(tx integer, ty integer, mask smallint, hydrated boolean, distance smallint)
   where p.profile_id = p_profile_id
     and p.tx = n.tx
     and p.ty = n.ty
     and (p.mask, p.hydrated, p.distance)
         is distinct from (n.mask, n.hydrated, n.distance);
end;
$$;

revoke execute on function public.sync_homestead_pipe_network(uuid, jsonb)
  from public, anon, authenticated;

-- No change to homestead_units. A crop that a hydrated pipe waters is kept
-- growing by the server treating it as never-dry (isStackAcresUnitDry's new
-- `irrigated` argument) and rolling last_watered_at forward with ZERO
-- excluded time on every layout change -- both are code, using the existing
-- version-guarded waterStackAcresUnit UPDATE path. The soil-watering column
-- (20260904120000) already carries everything that needs.
