-- The Mine's three Stone nodes: real, tappable boulders
-- (public/stackacres-td/areas/mine/area.json's p8_0/p9_0/p10_0, tagged
-- stone:mine-1/2/3), tracked GLOBALLY rather than per profile. See
-- lib/stackacres/stone-nodes.ts for the pure hit-count/regrow model this
-- table stores, and lib/server/stone-node-store.ts for the memory-mode
-- mirror this migration's RPC has to match exactly.
--
-- ONE ROW PER NODE, NEVER PER PLAYER: a boulder is a fixture of the shared
-- world, so a swing from any player has to see and update the same row --
-- unlike a per-profile store (wheat plots, machines, blueprints), there is
-- nothing here to scope by profile_id at all.
--
-- mine_stackacres_stone_node is the one write that matters: it locks the
-- node row, applies a regrow if the node has been broken for at least
-- REGROW_MS (18 minutes, hardcoded below to match
-- lib/stackacres/stone-nodes.ts's own constant -- see that file's own
-- comment on why it deliberately does not share a value with wood
-- chopping's own regrow), then applies exactly one swing. `p_quality` only
-- ever changes how much Stone the swing pays out (1 for a plain hit, 2 for
-- a graded "sweet" swing) -- it can never change whether the swing lands or
-- how many hits the node has left, both of which are read from the row
-- under lock, never from the caller.

create table public.homestead_stone_nodes (
  node_id text primary key,
  hits_remaining smallint not null check (hits_remaining >= 0),
  broken_at timestamptz,
  version integer not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.homestead_stone_nodes is
  'One row per Mine boulder (stone:mine-1/2/3). Global, not per-profile -- see this file''s header.';
comment on column public.homestead_stone_nodes.hits_remaining is
  'Swings left before the node breaks. Meaningless once broken_at is set; read through mine_stackacres_stone_node, which applies a regrow before trusting it.';
comment on column public.homestead_stone_nodes.broken_at is
  'When the node broke, or null while standing. A swing arriving REGROW_MS or more after this treats the node as fresh again, inside the same guarded update -- never a separate cron.';

insert into public.homestead_stone_nodes (node_id, hits_remaining, broken_at, version)
values
  ('stone:mine-1', 4, null, 0),
  ('stone:mine-2', 4, null, 0),
  ('stone:mine-3', 4, null, 0)
on conflict (node_id) do nothing;

alter table public.homestead_stone_nodes enable row level security;
-- No policy is added: every access goes through the security-definer RPCs
-- below via the service role, the same posture every other StackAcres
-- table with no direct client read/write takes.

create or replace function public.mine_stackacres_stone_node(
  p_node_id text,
  p_quality text,
  p_now timestamptz
)
returns table (
  landed boolean,
  broke boolean,
  yield_amount integer,
  node_id text,
  hits_remaining smallint,
  broken_at timestamptz,
  version integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.homestead_stone_nodes%rowtype;
  v_hits_to_break constant smallint := 4;
  v_regrow_ms constant bigint := 18 * 60 * 1000;
  v_yield integer;
begin
  if p_quality not in ('hit', 'sweet') then
    raise exception 'Invalid swing quality' using errcode = '22023';
  end if;

  select * into v_row
  from public.homestead_stone_nodes
  where public.homestead_stone_nodes.node_id = p_node_id
  for update;

  if not found then
    raise exception 'No such stone node' using errcode = '22023';
  end if;

  -- Regrow first, under the same lock, so two racing swings can never both
  -- "discover" the same regrow and both take a fresh node's first hit twice.
  if v_row.broken_at is not null
     and extract(epoch from (p_now - v_row.broken_at)) * 1000 >= v_regrow_ms then
    v_row.hits_remaining := v_hits_to_break;
    v_row.broken_at := null;
  end if;

  if v_row.broken_at is not null or v_row.hits_remaining <= 0 then
    -- Already broken, not yet regrown: the swing does not land. Nothing is
    -- spent or paid, and the row is still written back so a regrow applied
    -- above (if any) is not lost.
    update public.homestead_stone_nodes
    set hits_remaining = v_row.hits_remaining,
        broken_at = v_row.broken_at,
        updated_at = p_now
    where public.homestead_stone_nodes.node_id = p_node_id;

    return query select false, false, 0, v_row.node_id, v_row.hits_remaining, v_row.broken_at, v_row.version;
    return;
  end if;

  v_yield := case p_quality when 'sweet' then 2 else 1 end;
  v_row.hits_remaining := v_row.hits_remaining - 1;

  if v_row.hits_remaining <= 0 then
    v_row.broken_at := p_now;
  end if;

  update public.homestead_stone_nodes
  set hits_remaining = v_row.hits_remaining,
      broken_at = v_row.broken_at,
      version = version + 1,
      updated_at = p_now
  where public.homestead_stone_nodes.node_id = p_node_id
  returning version into v_row.version;

  return query
    select true, (v_row.broken_at is not null), v_yield, v_row.node_id, v_row.hits_remaining, v_row.broken_at, v_row.version;
end;
$$;

revoke all on function public.mine_stackacres_stone_node(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.mine_stackacres_stone_node(text, text, timestamptz) to service_role;
