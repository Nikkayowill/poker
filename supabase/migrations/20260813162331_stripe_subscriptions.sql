-- Subscription state for monthly support ($2.99/$5.99/$9.99 --
-- lib/legal/documents.ts's support_disclosure). Grants nothing gameplay-
-- relevant: this table is a read-only mirror of Stripe's own subscription
-- object for the support panel to render a membership card from, and the
-- "Manage membership" button's source of a Stripe customer id.
--
-- This is a mutable STATE table, not an append-only ledger like
-- stripe_payments -- a row is upserted in place on every subscription
-- lifecycle event, the same way a profiles row is mutable rather than an
-- event log. Idempotency here is a recency guard (a late-delivered or
-- redelivered webhook must never regress a newer status), not the
-- append-only "insert once" idiom stripe_payments uses.

create table if not exists public.stripe_subscriptions (
  stripe_subscription_id text primary key,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  stripe_customer_id text not null,
  tier_key text not null check (tier_key in ('supporter', 'backer', 'patron')),
  status text not null check (status in (
    'active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'
  )),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  livemode boolean not null default true,
  -- The originating Stripe event's own `created` timestamp, not when we
  -- happened to process it -- the recency guard in upsert_stripe_subscription
  -- compares Stripe's event ordering, not our arrival order (retries and
  -- redeliveries can arrive out of order).
  event_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stripe_subscriptions_profile_idx on public.stripe_subscriptions (profile_id);
create index if not exists stripe_subscriptions_customer_idx on public.stripe_subscriptions (stripe_customer_id);

alter table public.stripe_subscriptions enable row level security;
revoke all on table public.stripe_subscriptions from public, anon, authenticated;

comment on table public.stripe_subscriptions is
  'Server-only, recency-guarded mirror of Stripe subscription state for monthly support. Grants nothing gameplay-relevant -- see lib/legal/documents.ts support_disclosure.';

create or replace function public.upsert_stripe_subscription(
  p_stripe_subscription_id text,
  p_profile_id uuid,
  p_stripe_customer_id text,
  p_tier_key text,
  p_status text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_canceled_at timestamptz,
  p_livemode boolean,
  p_event_created_at timestamptz
) returns public.stripe_subscriptions
language plpgsql
security invoker
set search_path = public
as $$
declare
  result public.stripe_subscriptions;
begin
  insert into public.stripe_subscriptions (
    stripe_subscription_id, profile_id, stripe_customer_id, tier_key, status,
    current_period_start, current_period_end, cancel_at_period_end, canceled_at,
    livemode, event_created_at
  ) values (
    p_stripe_subscription_id, p_profile_id, p_stripe_customer_id, p_tier_key, p_status,
    p_current_period_start, p_current_period_end, p_cancel_at_period_end, p_canceled_at,
    p_livemode, p_event_created_at
  )
  on conflict (stripe_subscription_id) do update set
    stripe_customer_id = excluded.stripe_customer_id,
    tier_key = excluded.tier_key,
    status = excluded.status,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    canceled_at = excluded.canceled_at,
    event_created_at = excluded.event_created_at,
    updated_at = now()
  -- The guard: a webhook delivered out of order must never overwrite a
  -- newer status with a stale one. Adapted from
  -- lib/server/pvp-challenge-store.ts's "the UPDATE's predicate IS the
  -- guard" idiom -- there the predicate is a one-shot status transition,
  -- here it is event recency, because this row is updated repeatedly rather
  -- than settled once.
  where public.stripe_subscriptions.event_created_at is null
     or excluded.event_created_at >= public.stripe_subscriptions.event_created_at
  returning * into result;

  if result.stripe_subscription_id is null then
    -- INSERT .. ON CONFLICT DO UPDATE .. WHERE <guard failed> neither
    -- inserts (a conflicting row already exists) nor updates (the guard
    -- failed), so RETURNING yields nothing and result stays unset. Unlike
    -- fulfill_stripe_payment's "someone already did this, return false",
    -- a stale event here should not leave the caller with nothing -- it
    -- should still get back whatever the current row actually is.
    select * into result from public.stripe_subscriptions where stripe_subscription_id = p_stripe_subscription_id;
  end if;
  return result;
end;
$$;

revoke all on function public.upsert_stripe_subscription(text, uuid, text, text, text, timestamptz, timestamptz, boolean, timestamptz, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.upsert_stripe_subscription(text, uuid, text, text, text, timestamptz, timestamptz, boolean, timestamptz, boolean, timestamptz)
  to service_role;
