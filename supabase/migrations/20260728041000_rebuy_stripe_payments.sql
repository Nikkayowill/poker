-- A rebuy is a real player action and must be represented in the audit enum.
alter type public.action_type add value if not exists 'rebuy';

-- Stripe fulfillment is kept separate from gameplay state. The unique Stripe
-- session id is the idempotency key: webhook retries can never grant Gold twice.
create table if not exists public.stripe_payments (
  stripe_session_id text primary key,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  kind text not null check (kind = 'rebuy_gold'),
  gold_amount integer not null check (gold_amount > 0),
  fulfilled_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.stripe_payments enable row level security;
revoke all on table public.stripe_payments from public, anon, authenticated;

create or replace function public.fulfill_stripe_payment(
  p_stripe_session_id text,
  p_profile_id uuid,
  p_gold_amount integer
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

  insert into public.stripe_payments (
    stripe_session_id, profile_id, kind, gold_amount
  ) values (
    p_stripe_session_id, p_profile_id, 'rebuy_gold', p_gold_amount
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

revoke all on function public.fulfill_stripe_payment(text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.fulfill_stripe_payment(text, uuid, integer)
  to service_role;

comment on table public.stripe_payments is
  'Server-only, idempotent Stripe fulfillment ledger for in-game purchases.';
