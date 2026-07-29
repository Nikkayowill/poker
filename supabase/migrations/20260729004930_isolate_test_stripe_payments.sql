-- Isolates Stripe test-mode purchases from the real economy: every payment
-- now records which Stripe mode it was, and a test-mode fulfillment credits
-- a separate ledger column that no leaderboard, season, stat or achievement
-- query ever reads, rather than the real gold_balance.
--
-- Which profiles may even attempt a test purchase is enforced entirely in
-- application code (STRIPE_TEST_ALLOWED_PROFILE_IDS, a server-only env var)
-- -- nothing here trusts the client for that, and this migration does not
-- need to know the allowlist to keep test and live Gold apart.

alter table public.stripe_payments
  add column if not exists livemode boolean not null default true;

comment on column public.stripe_payments.livemode is
  'Whether this payment was a real Stripe charge. False rows are test-mode purchases from an allowlisted test profile and never touched gold_balance.';

alter table public.profiles
  add column if not exists test_gold_balance integer not null default 0
    check (test_gold_balance >= 0);

comment on column public.profiles.test_gold_balance is
  'Stripe test-mode Gold only. Isolated from gold_balance on purpose: no leaderboard, season, stat, or achievement query reads this column.';

-- Postgres overloads by argument list -- drop the 5-arg version outright
-- rather than leave it reachable as dead code with an ambiguous default.
drop function if exists public.fulfill_stripe_payment(text, uuid, integer, text, text);

create function public.fulfill_stripe_payment(
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
    stripe_session_id, profile_id, kind, tier_key, gold_amount, livemode
  ) values (
    p_stripe_session_id, p_profile_id, p_kind, p_tier_key, p_gold_amount, p_livemode
  ) on conflict (stripe_session_id) do nothing;

  if not found then
    return false;
  end if;

  if p_livemode then
    update public.profiles
    set gold_balance = case
      when unlimited_gold then gold_balance
      else gold_balance + p_gold_amount
    end,
    updated_at = now()
    where id = p_profile_id;
  else
    -- Test Gold is unconditional -- unlimited_gold only ever applies to the
    -- real economy, and a test profile still needs to see the fulfillment
    -- land to be useful for verification.
    update public.profiles
    set test_gold_balance = test_gold_balance + p_gold_amount,
        updated_at = now()
    where id = p_profile_id;
  end if;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  return true;
end;
$$;

revoke all on function public.fulfill_stripe_payment(text, uuid, integer, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.fulfill_stripe_payment(text, uuid, integer, text, text, boolean)
  to service_role;
