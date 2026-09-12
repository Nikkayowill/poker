-- Restores homestead_museum_donations and mark_homestead_museum_donation,
-- dropped an hour earlier by 20260911170000_stackacres_drop_museum.sql on
-- the mistaken assumption that nothing but the deleted museum feature used
-- them. It was wrong: this table is also the Hidden Secrets donation
-- register (`donateStackAcresSecretItem` in lib/server/stackacres-service.ts,
-- via `readStackAcresMuseum`/`markStackAcresDonated` in
-- lib/server/stackacres-store.ts), an unrelated feature that was never
-- meant to be touched and stayed live in the app the whole time. Same
-- schema as the original (20260904120000_homestead_museum.sql), unrenamed
-- on purpose: the app code still calls it by this name, and a rename here
-- is a second migration for no functional reason.
--
-- THE 18 DONATION ROWS THAT TABLE HELD ARE NOT RECOVERABLE -- dropping a
-- table is not reversible, and there was no backup taken before it ran.
-- Every player whose Hidden Secrets donations were wiped will see their
-- personal donation register as empty and can re-donate any item they still
-- hold; nothing else in the app depends on this history.

create table public.homestead_museum_donations (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null,
  donated_at timestamptz not null default now(),
  primary key (profile_id, item_id)
);

comment on table public.homestead_museum_donations is
  'Hidden Secrets donation register (lib/stackacres/secrets.ts): which item ids a player has ever donated to Ray. No quantity, no undonate. Service-role only. Name predates a since-removed "Ray''s Museum" feature this table also used to back.';

alter table public.homestead_museum_donations enable row level security;
revoke all on public.homestead_museum_donations from anon, authenticated;

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

revoke all on function public.mark_homestead_museum_donation(uuid, text) from public, anon, authenticated;
