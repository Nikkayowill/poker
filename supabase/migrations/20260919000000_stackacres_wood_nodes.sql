/* -------------------------------------------------------------------- */
/* Choppable trees: Wood, the farm's first gather-in-the-world material  */
/* -------------------------------------------------------------------- */

-- One row per (profile, tree node). `node_id` is one of the fixed ids in
-- lib/stackacres/tree-nodes.ts (WOOD_NODE_IDS), not a free-text place --
-- application code is the source of truth for which ids exist, the same
-- posture homestead_machines takes for `kind`.
create table public.homestead_wood_nodes (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  node_id text not null,
  hits_remaining integer not null default 3 check (hits_remaining >= 0),
  felled_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  primary key (profile_id, node_id)
);

comment on table public.homestead_wood_nodes is
  'One tree''s chop state per profile: swings left in this cycle, and when it fell if it did. Guarded by version (compare-and-swap update, no RPC needed) the same shape homestead_machines uses -- see writeStackAcresWoodNodeSwing in lib/server/stackacres-store.ts. A missing row reads as a fresh, standing tree; it is created lazily on a profile''s first tap. Service-role only.';

alter table public.homestead_wood_nodes enable row level security;
revoke all on public.homestead_wood_nodes from anon, authenticated;
