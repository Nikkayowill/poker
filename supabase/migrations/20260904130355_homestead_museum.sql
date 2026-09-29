-- Ray's Museum: a one-time collection flag per produce item, per player.
--
-- One row per (profile, item) donated, ever -- there is no "undonate" and no
-- quantity, so a bare existence check is the whole model, the same shape
-- head_to_head_records or a mission's own completion row already use. The
-- exhibit an item belongs to is not stored here: lib/stackacres/museum.ts
-- owns that grouping so a retune of the exhibits needs no migration.
--
-- Donation happens automatically inside collectStackAcres, the first time an
-- item is ever collected -- never a player action of its own -- and pays a
-- one-time "New Discovery!" bonus in BUSHELS. Gold does not move here: see
-- lib/server/stackacres-service.ts's own module doc for why no Gold may ever
-- be added to collectStackAcres.

create table public.homestead_museum_donations (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null,
  donated_at timestamptz not null default now(),
  primary key (profile_id, item_id)
);

comment on table public.homestead_museum_donations is
  'Ray''s Museum: which produce items a player has ever donated (first-time-harvest only). No quantity, no undonate. Service-role only.';

alter table public.homestead_museum_donations enable row level security;
revoke all on public.homestead_museum_donations from anon, authenticated;

-- INSERT ... ON CONFLICT DO NOTHING against the primary key is the whole
-- idempotency guard, the same shape grant_homestead_starting_bushels already
-- uses: a duplicate donation is a no-op that reports false, which is exactly
-- how the caller tells a genuine first discovery from a repeat harvest.
create or replace function public.mark_homestead_museum_donation(
  p_profile_id uuid,
  p_item_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  donated boolean := false;
begin
  insert into public.homestead_museum_donations (profile_id, item_id)
  values (p_profile_id, p_item_id)
  on conflict (profile_id, item_id) do nothing;

  donated := found;
  return donated;
end;
$$;

comment on function public.mark_homestead_museum_donation(uuid, text) is
  'Flags one item donated, exactly once. Returns true only on the insert that actually donated it; the primary key is the idempotency guard.';

-- `public` is load-bearing here, not redundant with anon/authenticated: see
-- 20260901130000's own comment and reference_stackchips_revoke_execute_from_public
-- -- omitting it has shipped a SECURITY DEFINER function anonymously callable
-- on /rest/v1/rpc twice already. Verify with \df+ / proacl after applying,
-- not by re-reading this file.
revoke all on function public.mark_homestead_museum_donation(uuid, text) from public, anon, authenticated;
