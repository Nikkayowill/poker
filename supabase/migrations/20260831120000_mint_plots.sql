-- The Sovereign Mint: an idle treasury of staked, timed Gold nodes.
--
-- One row per owned plot (lib/server/mint-store.ts's twin). A plot carries at
-- most one growing node; planting is an UPDATE empty -> growing that debits
-- first (rule 1 in lib/server/mint-service.ts), and harvesting is a single
-- guarded UPDATE growing -> empty whose version match is the settlement
-- idempotency key that makes a ripe node pay exactly once under a double-tap,
-- a retry, or two tabs. `payout` and `matures_at` are snapshotted from
-- lib/mint/nodes.ts at plant and never re-read at harvest, the same rule
-- StoredWordStackRound.wagerLadder states: a retune must not change what an
-- already-planted node pays.

create table public.mint_plots (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  plot_index int not null check (plot_index between 1 and 16),
  status text not null default 'empty' check (status in ('empty', 'growing')),
  node_type text check (node_type in ('pulse', 'core', 'matrix')),
  -- Already debited by the time this is set (rule 1). Stored, not derived,
  -- so the ledger records exactly what was staked.
  stake integer check (stake > 0),
  -- Snapshotted at plant; the single credit at harvest is exactly this.
  payout integer check (payout > 0),
  planted_at timestamptz,
  matures_at timestamptz,
  -- Optimistic concurrency, same contract as ante_up_attempts.version: every
  -- mutation is an UPDATE ... where version = <the one just read>, and the
  -- harvest write is the one that pays.
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  -- A true row invariant (safe as a CHECK precisely because every write
  -- keeps it true): a growing plot carries a whole node, an empty plot
  -- carries none of one. The *tunable* rules live in the trigger below
  -- instead -- see that comment for why.
  constraint mint_plots_node_matches_status check (
    (status = 'growing') = (
      node_type is not null and stake is not null and payout is not null
      and planted_at is not null and matures_at is not null
    )
  )
);

comment on table public.mint_plots is
  'One Sovereign Mint plot per row. A growing node''s stake is already debited; harvest credits the snapshotted payout exactly once, guarded by version. Service-role only.';

comment on column public.mint_plots.payout is
  'Snapshotted from lib/mint/nodes.ts at plant, never re-read at harvest: a retune must not change what an already-planted node pays.';

-- One row per (player, tile); lib/server/mint-store.ts catches 23505 off
-- this rather than read-first checking, so a double-clicked purchase
-- refunds instead of charging twice.
create unique index mint_plots_one_row_per_plot
  on public.mint_plots(profile_id, plot_index);

-- The concurrent-cap count and the treasury read both filter on this.
create index mint_plots_growing_idx
  on public.mint_plots(profile_id)
  where status = 'growing';

alter table public.mint_plots enable row level security;
revoke all on public.mint_plots from anon, authenticated;

-- WHY A TRIGGER AND NOT CHECK CONSTRAINTS, for the tunable rules
--
-- Same reasoning as ante_up_attempts_enforce_wager_ceiling, which learned it
-- the hard way: a CHECK re-evaluates on every UPDATE, and settlement here is
-- an UPDATE (the harvest). A payout ceiling as a CHECK would, after a retune
-- lowered it, make an in-flight node opened under the old numbers throw on
-- its own harvest: unsettleable forever, stake already debited. A BEFORE
-- trigger that only fires when a node is being PLANTED (new.status =
-- 'growing') says what is meant -- a node may not be opened outside the
-- current tuning -- and cannot interfere with harvesting one that already
-- exists, because a harvest writes status = 'empty' and never trips it.
--
-- The same trigger enforces the concurrent-node cap, under an advisory lock
-- so two racing plants cannot both pass the count (the pattern
-- admob_ssv_receipts_daily_cap established).

create or replace function public.mint_plots_enforce_node_shape()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  payout_ceiling integer;
  growing_count integer;
begin
  -- Keep these in step with lib/mint/nodes.ts's MINT_NODES and
  -- MINT_CONCURRENT_NODE_CAP. Duplicated on purpose -- a trigger cannot
  -- import a TypeScript module -- and a retune that moves one without the
  -- other turns a permitted plant into a 500 from the database instead of a
  -- clean 400 from the service.
  payout_ceiling := case new.node_type
    when 'pulse' then 1050
    when 'core' then 10600
    when 'matrix' then 52500
    -- Any node type not listed yields NULL and is left alone, fail-open on
    -- purpose: a node added later belongs in nodes.ts first and here second.
    else null
  end;

  if payout_ceiling is not null and new.payout > payout_ceiling then
    raise exception
      'Mint payout % exceeds the ceiling of % for node %',
      new.payout, payout_ceiling, new.node_type
      using errcode = 'check_violation';
  end if;

  -- Serialize this player's plants so the count below cannot be raced past.
  perform pg_advisory_xact_lock(hashtext(new.profile_id::text));

  select count(*) into growing_count
  from public.mint_plots
  where profile_id = new.profile_id
    and status = 'growing'
    and id <> new.id;

  if growing_count >= 3 then
    raise exception
      'Mint node cap reached: % nodes already growing', growing_count
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.mint_plots_enforce_node_shape() is
  'Gates what may be PLANTED (payout ceiling per node type, concurrent-node cap). Mirrors lib/mint/nodes.ts. Fires only when a row turns growing, so it can never block a harvest; see the migration that added it for why CHECKs would brick in-flight nodes.';

drop trigger if exists mint_plots_node_shape on public.mint_plots;
create trigger mint_plots_node_shape
  before insert or update on public.mint_plots
  for each row
  when (new.status = 'growing')
  execute function public.mint_plots_enforce_node_shape();

-- The economy ledger: every settled harvest, append-only. The Mint is a
-- guaranteed win, so how much this faucet pours is a number the economy
-- dashboards must be able to answer without archaeology. Written best-effort
-- after the credit (a ledger failure never voids a settled harvest).

create table public.mint_harvests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  plot_index int not null check (plot_index between 1 and 16),
  node_type text not null check (node_type in ('pulse', 'core', 'matrix')),
  stake integer not null check (stake > 0),
  payout integer not null check (payout > 0),
  planted_at timestamptz not null,
  harvested_at timestamptz not null default now()
);

comment on table public.mint_harvests is
  'Append-only record of settled Sovereign Mint harvests, for economy telemetry. Service-role only.';

create index mint_harvests_profile_recent_idx
  on public.mint_harvests(profile_id, harvested_at desc);

alter table public.mint_harvests enable row level security;
revoke all on public.mint_harvests from anon, authenticated;
