-- Widens legal_acceptances for the new privacy_policy/support_disclosure
-- slugs (lib/legal/documents.ts) and turns stripe_payments/
-- fulfill_stripe_payment into a system where a payment can credit nothing.
--
-- Nothing here touches an existing row's meaning. gold_disclosure stays in
-- the allowed document set (historical acceptance rows already carry it,
-- and ALTER TABLE ADD CONSTRAINT re-validates every existing row against the
-- new list -- dropping it would break this migration the moment a single
-- old row exists). rebuy_gold/gold_purchase stay in the allowed kind set for
-- the same reason.

-- ---- legal_acceptances: two new slugs -----------------------------------

alter table public.legal_acceptances
  drop constraint if exists legal_acceptances_document_check;
alter table public.legal_acceptances
  add constraint legal_acceptances_document_check
    check (document in ('terms_of_service', 'gold_disclosure', 'privacy_policy', 'support_disclosure'));

-- ---- stripe_payments: a payment that credits nothing --------------------
--
-- support_one_time is StackChips's voluntary support payment -- it inserts a
-- ledger row (audit trail + the Stripe session id idempotency key) and never
-- touches profiles.gold_balance. gold_amount is therefore no longer
-- universal across every kind.

alter table public.stripe_payments
  alter column gold_amount drop not null;
alter table public.stripe_payments
  drop constraint if exists stripe_payments_gold_amount_check;
alter table public.stripe_payments
  add constraint stripe_payments_gold_amount_check
    check (gold_amount is null or gold_amount > 0);

alter table public.stripe_payments
  drop constraint if exists stripe_payments_kind_check;
alter table public.stripe_payments
  add constraint stripe_payments_kind_check
    check (kind in ('rebuy_gold', 'gold_purchase', 'support_one_time'));

alter table public.stripe_payments
  drop constraint if exists stripe_payments_tier_key_check;
alter table public.stripe_payments
  add constraint stripe_payments_tier_key_check
    check (kind not in ('gold_purchase', 'support_one_time') or tier_key is not null);

comment on column public.stripe_payments.gold_amount is
  'Gold credited by this payment, or null for a kind that credits nothing (support_one_time). Historical rebuy_gold/gold_purchase rows are always non-null.';

-- Same signature (text, uuid, integer, text, text, boolean) as the existing
-- function -- CREATE OR REPLACE in place, no new overload, because the
-- change is column nullability plus a conditional credit branch, not a new
-- parameter.
create or replace function public.fulfill_stripe_payment(
  p_stripe_session_id text,
  p_profile_id uuid,
  p_gold_amount integer,
  p_kind text default 'rebuy_gold',
  p_tier_key text default null,
  p_livemode boolean default true
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_stripe_session_id is null or length(trim(p_stripe_session_id)) < 10 then
    raise exception 'Invalid Stripe session id' using errcode = '22023';
  end if;
  if p_kind not in ('rebuy_gold', 'gold_purchase', 'support_one_time') then
    raise exception 'Invalid payment kind' using errcode = '22023';
  end if;
  if p_kind in ('rebuy_gold', 'gold_purchase') and (p_gold_amount is null or p_gold_amount <= 0) then
    raise exception 'Invalid Gold amount' using errcode = '22023';
  end if;
  if p_kind in ('gold_purchase', 'support_one_time') and p_tier_key is null then
    raise exception 'A tiered purchase requires a tier key' using errcode = '22023';
  end if;

  insert into public.stripe_payments (
    stripe_session_id, profile_id, kind, tier_key, gold_amount, livemode
  ) values (
    p_stripe_session_id, p_profile_id, p_kind, p_tier_key, p_gold_amount, p_livemode
  ) on conflict (stripe_session_id) do nothing;

  if not found then
    return false;
  end if;

  -- Crediting is conditional on kind now, not unconditional on every
  -- payment. support_one_time already inserted its ledger row above and
  -- stops here -- gold_balance/test_gold_balance is never touched, which is
  -- the whole point of a support payment (lib/legal/documents.ts's
  -- support_disclosure). Its profile-existence check rides on the INSERT's
  -- own profile_id foreign key above, not an UPDATE row count, since there
  -- is no UPDATE on this branch.
  if p_kind in ('rebuy_gold', 'gold_purchase') then
    if p_livemode then
      update public.profiles
      set gold_balance = case
        when unlimited_gold then gold_balance
        else gold_balance + p_gold_amount
      end,
      updated_at = now()
      where id = p_profile_id;
    else
      -- Test Gold is unconditional -- unlimited_gold only ever applies to
      -- the real economy, and a test profile still needs to see the
      -- fulfillment land to be useful for verification.
      update public.profiles
      set test_gold_balance = test_gold_balance + p_gold_amount,
          updated_at = now()
      where id = p_profile_id;
    end if;

    if not found then
      raise exception 'Profile not found' using errcode = 'P0002';
    end if;
  end if;

  return true;
end;
$$;

revoke all on function public.fulfill_stripe_payment(text, uuid, integer, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.fulfill_stripe_payment(text, uuid, integer, text, text, boolean)
  to service_role;
