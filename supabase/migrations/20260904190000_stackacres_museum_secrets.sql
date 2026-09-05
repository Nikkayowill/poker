-- Ray's Museum, secret wing: a rare, optional find layer on top of
-- 20260904120000's guaranteed produce donations.
--
-- Same shape as homestead_museum_donations, deliberately not the same table:
-- a secret find is rolled (lib/stackacres/museum-secrets.ts's
-- `rollSecretArtifact`) rather than guaranteed, covers a different item id
-- space (the hidden catalogue, not StackAcresItem), and is read/written by a
-- different call site. One row per (profile, item) found, ever -- no
-- quantity, no un-find.
--
-- NAME CHECKED AGAINST THE LIVE SCHEMA FIRST, not just this repo's own
-- migrations: a `homestead_inventory` table and an `adjust_homestead_
-- inventory(uuid, text, integer)` RPC already exist live, left over from the
-- pre-single-currency barn era (see lib/server/stackacres-store.ts's own
-- header) and inert but NOT gone -- CREATE TABLE on that name would fail
-- outright and CREATE OR REPLACE FUNCTION on that exact signature would
-- silently replace a live function's body. Confirmed via information_schema
-- that this table and RPC's own names are free.

create table public.homestead_museum_secrets (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null,
  found_at timestamptz not null default now(),
  primary key (profile_id, item_id)
);

comment on table public.homestead_museum_secrets is
  'Ray''s Museum, secret wing: hidden collectibles a player has ever rolled off a critical harvest (lib/stackacres/museum-secrets.ts). No quantity, no un-find. Service-role only.';

alter table public.homestead_museum_secrets enable row level security;
revoke all on public.homestead_museum_secrets from anon, authenticated;

-- INSERT ... ON CONFLICT DO NOTHING against the primary key is the whole
-- idempotency guard, the same shape mark_homestead_museum_donation already
-- uses: a repeat find is a no-op that reports false, which is exactly how
-- the caller tells a genuine first find from a re-roll of something already
-- on the shelf.
create or replace function public.mark_homestead_museum_secret(
  p_profile_id uuid,
  p_item_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  -- NOT named `found` -- that shadows PL/pgSQL's own special FOUND variable,
  -- which is exactly what this reads on the next line. The donation
  -- migration's local is `donated` for the identical reason; this one is
  -- `secret_found`.
  secret_found boolean := false;
begin
  insert into public.homestead_museum_secrets (profile_id, item_id)
  values (p_profile_id, p_item_id)
  on conflict (profile_id, item_id) do nothing;

  secret_found := found;
  return secret_found;
end;
$$;

comment on function public.mark_homestead_museum_secret(uuid, text) is
  'Flags one hidden item found, exactly once. Returns true only on the insert that actually registered it; the primary key is the idempotency guard.';

-- `public` is load-bearing here, not redundant with anon/authenticated: see
-- 20260901130000's own comment and reference_stackchips_revoke_execute_from_public
-- -- omitting it has shipped a SECURITY DEFINER function anonymously callable
-- on /rest/v1/rpc twice already. Verify with \df+ / proacl after applying,
-- not by re-reading this file.
revoke all on function public.mark_homestead_museum_secret(uuid, text) from public, anon, authenticated;
