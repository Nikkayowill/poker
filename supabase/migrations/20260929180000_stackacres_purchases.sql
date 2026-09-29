-- The one-time StackAcres purchase. A paid Checkout Session flips
-- profiles.homestead_access on; a full refund or a dispute flips it back off,
-- but only when the purchase is what turned it on. An admin grant made before
-- the purchase stays.
--
-- The Stripe session id is the idempotency key, so a webhook retry and the
-- browser's return-trip verification can both call fulfill safely.
create table if not exists public.stackacres_purchases (
  stripe_session_id text primary key,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  stripe_payment_intent_id text not null,
  livemode boolean not null default true,
  -- True when this purchase is what flipped homestead_access from off to on.
  granted_access boolean not null,
  status text not null default 'paid' check (status in ('paid', 'refunded', 'disputed')),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists stackacres_purchases_payment_intent_idx
  on public.stackacres_purchases (stripe_payment_intent_id);
create index if not exists stackacres_purchases_profile_idx
  on public.stackacres_purchases (profile_id);

alter table public.stackacres_purchases enable row level security;
revoke all on table public.stackacres_purchases from public, anon, authenticated;

create or replace function public.fulfill_stackacres_purchase(
  p_stripe_session_id text,
  p_profile_id uuid,
  p_payment_intent_id text,
  p_livemode boolean default true
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  had_access boolean;
begin
  if p_stripe_session_id is null or length(trim(p_stripe_session_id)) < 10 then
    raise exception 'Invalid Stripe session id' using errcode = '22023';
  end if;
  if p_payment_intent_id is null or length(trim(p_payment_intent_id)) < 3 then
    raise exception 'Invalid payment intent id' using errcode = '22023';
  end if;

  select homestead_access into had_access
  from public.profiles
  where id = p_profile_id
  for update;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  insert into public.stackacres_purchases (
    stripe_session_id, profile_id, stripe_payment_intent_id, livemode, granted_access
  ) values (
    p_stripe_session_id, p_profile_id, p_payment_intent_id, p_livemode, not had_access
  ) on conflict do nothing;

  if not found then
    return false;
  end if;

  update public.profiles
  set homestead_access = true,
      updated_at = now()
  where id = p_profile_id;
  return true;
end;
$$;

-- Releases a purchase's access exactly once. The status guard makes the UPDATE
-- return the row at most one time, so a refund event and a dispute event for
-- the same payment cannot both revoke. Returns the profile id, or null when
-- there was nothing to revoke (unknown payment, or already revoked).
create or replace function public.revoke_stackacres_purchase(
  p_payment_intent_id text,
  p_status text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  purchase public.stackacres_purchases;
begin
  if p_status not in ('refunded', 'disputed') then
    raise exception 'Invalid purchase status' using errcode = '22023';
  end if;

  update public.stackacres_purchases
  set status = p_status,
      revoked_at = now()
  where stripe_payment_intent_id = p_payment_intent_id
    and status = 'paid'
  returning * into purchase;

  if not found then
    return null;
  end if;

  -- Access goes only when no other purchase on this profile is still paid,
  -- and only when a purchase (this one or an earlier refunded one) is what
  -- turned it on. An admin grant made before any purchase stays.
  if not exists (
    select 1 from public.stackacres_purchases
    where profile_id = purchase.profile_id and status = 'paid'
  ) and exists (
    select 1 from public.stackacres_purchases
    where profile_id = purchase.profile_id and granted_access
  ) then
    update public.profiles
    set homestead_access = false,
        updated_at = now()
    where id = purchase.profile_id;
  end if;
  return purchase.profile_id;
end;
$$;

-- A dispute the seller won puts the purchase, and the access it gave, back.
-- Status-guarded like the revoke: it returns the profile at most once.
create or replace function public.restore_stackacres_purchase(
  p_payment_intent_id text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  purchase public.stackacres_purchases;
begin
  update public.stackacres_purchases
  set status = 'paid',
      revoked_at = null
  where stripe_payment_intent_id = p_payment_intent_id
    and status = 'disputed'
  returning * into purchase;

  if not found then
    return null;
  end if;

  update public.profiles
  set homestead_access = true,
      updated_at = now()
  where id = purchase.profile_id;
  return purchase.profile_id;
end;
$$;

revoke all on function public.fulfill_stackacres_purchase(text, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.fulfill_stackacres_purchase(text, uuid, text, boolean)
  to service_role;
revoke all on function public.revoke_stackacres_purchase(text, text)
  from public, anon, authenticated;
grant execute on function public.revoke_stackacres_purchase(text, text)
  to service_role;
revoke all on function public.restore_stackacres_purchase(text)
  from public, anon, authenticated;
grant execute on function public.restore_stackacres_purchase(text)
  to service_role;
