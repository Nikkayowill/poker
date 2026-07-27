-- Persistent Gold currency: a starting balance, a flat daily claim, an
-- unlimited-play flag for gifting a specific profile free chips, and the
-- guarded RPCs that spend/credit it atomically.

alter table public.profiles
  add column gold_balance integer not null default 2000
    check (gold_balance >= 0),
  add column unlimited_gold boolean not null default false,
  add column last_daily_claim_at timestamptz;

comment on column public.profiles.gold_balance is
  'Persistent currency spent on table buy-ins; 1 Gold = 1 chip.';
comment on column public.profiles.unlimited_gold is
  'When true, spend_gold is a no-op for this profile -- used to gift a specific person free play.';
comment on column public.profiles.last_daily_claim_at is
  'Timestamp of the last successful daily-Gold claim; the daily grant resets at UTC midnight.';

-- Guarded single-statement decrement: locks the row, then only deducts if
-- unlimited or the balance actually covers the amount, so two concurrent
-- spends can never both pass a stale balance check and drive it negative.
create or replace function public.spend_gold(p_token uuid, p_amount integer)
returns table (success boolean, gold_balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_unlimited boolean;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Invalid Gold amount' using errcode = '22023';
  end if;

  select p.gold_balance, p.unlimited_gold into v_balance, v_unlimited
  from public.profiles as p
  where p.session_token = p_token
  for update;

  if not found then
    return query select false, 0;
    return;
  end if;

  if not v_unlimited and v_balance < p_amount then
    return query select false, v_balance;
    return;
  end if;

  if not v_unlimited then
    update public.profiles
    set gold_balance = gold_balance - p_amount, updated_at = now()
    where session_token = p_token
    returning public.profiles.gold_balance into v_balance;
  end if;

  return query select true, v_balance;
end;
$$;

-- Same guarded-row-lock shape: only credits once per UTC calendar day.
create or replace function public.claim_daily_gold(p_token uuid, p_amount integer)
returns table (claimed boolean, gold_balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last timestamptz;
  v_balance integer;
begin
  select p.last_daily_claim_at, p.gold_balance into v_last, v_balance
  from public.profiles as p
  where p.session_token = p_token
  for update;

  if not found then
    return query select false, 0;
    return;
  end if;

  if v_last is not null and (v_last at time zone 'utc')::date = (now() at time zone 'utc')::date then
    return query select false, v_balance;
    return;
  end if;

  update public.profiles
  set gold_balance = gold_balance + p_amount,
      last_daily_claim_at = now(),
      updated_at = now()
  where session_token = p_token
  returning public.profiles.gold_balance into v_balance;

  return query select true, v_balance;
end;
$$;

revoke all on function public.spend_gold(uuid, integer) from public, anon, authenticated;
grant execute on function public.spend_gold(uuid, integer) to service_role;

revoke all on function public.claim_daily_gold(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_daily_gold(uuid, integer) to service_role;
