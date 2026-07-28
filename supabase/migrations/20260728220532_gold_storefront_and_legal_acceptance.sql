-- Generalizes stripe_payments from one fixed "rebuy_gold" product to any
-- number of Gold-pack tiers, and adds the Terms/disclosure acceptance
-- ledger required before a Checkout Session is ever created.
--
-- Nothing here touches an existing row. The rebuy path keeps working exactly
-- as it does today -- 'rebuy_gold' rows keep passing their existing check
-- constraint, and fulfill_stripe_payment's new parameters default to the
-- values that reproduce the old behaviour, so every call site that has not
-- been updated yet still works.

-- ---- Storefront tiers on the existing payments ledger ----------------

alter table public.stripe_payments
  add column if not exists tier_key text;

alter table public.stripe_payments
  drop constraint if exists stripe_payments_kind_check;
alter table public.stripe_payments
  add constraint stripe_payments_kind_check check (kind in ('rebuy_gold', 'gold_purchase'));

-- A general storefront purchase always carries which tier it was; the
-- original single-product rebuy did not need one and still does not.
alter table public.stripe_payments
  add constraint stripe_payments_tier_key_check
    check (kind <> 'gold_purchase' or tier_key is not null);

comment on column public.stripe_payments.tier_key is
  'Which Gold-pack tier this purchase was, for kind = gold_purchase. Null for the original single-product rebuy_gold rows.';

-- Postgres overloads by argument list, so `create or replace` on a signature
-- with two extra parameters would not replace the old 3-argument function --
-- it would leave both defined side by side. Every call site is updated in
-- this same change to pass all five arguments, so the old one is dropped
-- outright rather than kept as reachable dead code with a different name.
drop function if exists public.fulfill_stripe_payment(text, uuid, integer);

create function public.fulfill_stripe_payment(
  p_stripe_session_id text,
  p_profile_id uuid,
  p_gold_amount integer,
  p_kind text default 'rebuy_gold',
  p_tier_key text default null
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_stripe_session_id is null or length(trim(p_stripe_session_id)) < 10 then
    raise exception 'Invalid Stripe session id' using errcode = '22023';
  end if;
  if p_gold_amount is null or p_gold_amount <= 0 then
    raise exception 'Invalid Gold amount' using errcode = '22023';
  end if;
  if p_kind not in ('rebuy_gold', 'gold_purchase') then
    raise exception 'Invalid payment kind' using errcode = '22023';
  end if;
  if p_kind = 'gold_purchase' and p_tier_key is null then
    raise exception 'A storefront purchase requires a tier key' using errcode = '22023';
  end if;

  insert into public.stripe_payments (
    stripe_session_id, profile_id, kind, tier_key, gold_amount
  ) values (
    p_stripe_session_id, p_profile_id, p_kind, p_tier_key, p_gold_amount
  ) on conflict (stripe_session_id) do nothing;

  if not found then
    return false;
  end if;

  update public.profiles
  set gold_balance = case
    when unlimited_gold then gold_balance
    else gold_balance + p_gold_amount
  end,
  updated_at = now()
  where id = p_profile_id;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  return true;
end;
$$;

revoke all on function public.fulfill_stripe_payment(text, uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.fulfill_stripe_payment(text, uuid, integer, text, text)
  to service_role;

-- ---- Terms of Service / purchase disclosure acceptance ----------------
--
-- The document text and its version number live in application code
-- (lib/legal/documents.ts) -- this table only ever records *that* a profile
-- agreed to a specific version, not what the version said. Bumping the
-- version in code makes every existing acceptance stop counting as current
-- without needing a migration of its own.

create table if not exists public.legal_acceptances (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  document text not null check (document in ('terms_of_service', 'gold_disclosure')),
  version integer not null check (version > 0),
  accepted_at timestamptz not null default now(),
  unique (profile_id, document, version)
);

create index if not exists legal_acceptances_profile_idx on public.legal_acceptances (profile_id);

alter table public.legal_acceptances enable row level security;
revoke all on table public.legal_acceptances from public, anon, authenticated;

comment on table public.legal_acceptances is
  'Append-only record of which profile accepted which document version, and when. Never updated or deleted -- a re-acceptance after a version bump is a new row.';
