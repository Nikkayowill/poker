/* -------------------------------------------------------------------- */
/* Forageable bushes: where a crop seed comes from before there is Gold   */
/* -------------------------------------------------------------------- */

-- One row per (profile, bush). `node_id` is one of the fixed ids in
-- lib/stackacres/forage.ts (FORAGE_NODE_IDS), not a free-text place --
-- application code is the source of truth for which ids exist, the same
-- posture homestead_wood_nodes takes.
--
-- `picks` only ever counts up, and is NOT reset by a regrow: it is what
-- decides which seed the bush is carrying now (forageCrop), so resetting it
-- would pin every bush on its first crop forever.
create table public.homestead_forage_nodes (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  node_id text not null,
  picks integer not null default 0 check (picks >= 0),
  picked_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  primary key (profile_id, node_id)
);

comment on table public.homestead_forage_nodes is
  'One bush''s forage state per profile: how many times it has been picked (which decides the seed it carries), and when it was last picked. Guarded by version (compare-and-swap update, no RPC needed), the same shape homestead_wood_nodes uses -- see writeStackAcresForagePick in lib/server/stackacres-store.ts. A missing row reads as an untouched bush; it is created lazily on a profile''s first pick. Service-role only.';

alter table public.homestead_forage_nodes enable row level security;
revoke all on public.homestead_forage_nodes from anon, authenticated;
