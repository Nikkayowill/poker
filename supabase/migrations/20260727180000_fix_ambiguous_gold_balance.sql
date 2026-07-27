-- Both Gold RPCs declare RETURNS TABLE(..., gold_balance integer), which puts
-- `gold_balance` in scope as an OUT variable. That name then collides with the
-- profiles column of the same name, so the UPDATE's right-hand side
-- (`set gold_balance = gold_balance +/- p_amount`) raised
-- "column reference gold_balance is ambiguous" at runtime.
--
-- The failure hid well: spend_gold only reaches that UPDATE for a profile
-- WITHOUT unlimited_gold, and claim_daily_gold only reaches it for a profile
-- that exists and has not claimed today -- so every earlier smoke test either
-- returned early or ran against an unlimited profile. In practice it meant no
-- ordinary player could buy into a table at all.
--
-- Qualifying the right-hand side resolves it explicitly, without changing the
-- returned column names the application reads.

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
    set gold_balance = public.profiles.gold_balance - p_amount,
        updated_at = now()
    where session_token = p_token
    returning public.profiles.gold_balance into v_balance;
  end if;

  return query select true, v_balance;
end;
$$;

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
  set gold_balance = public.profiles.gold_balance + p_amount,
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
