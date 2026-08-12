-- Profile-id-keyed Gold movement, for player-versus-player settlement.
--
-- Every existing guarded Gold RPC -- spend_gold (20260727005110, fixed in
-- 20260727180000), credit_gold (20260804160000), claim_daily_gold -- is keyed
-- on `session_token`, because until now every Gold movement was made BY the
-- player it happened TO. The requester's cookie was the whole identity, and
-- keying on it is strictly better than keying on an id the request supplied.
--
-- The duels (lib/pvp/) break that assumption for the first time. When a chess
-- match ends, the pot has to reach the WINNER, and the request that ended it
-- came from whoever moved last -- which is the loser about half the time, and
-- on a timeout is neither player. There is no session token in hand for the
-- profile being paid. `adjustGold` already moves Gold by profile id, but it is
-- a plain read-then-write with no row lock: it is documented as an admin
-- correction tool precisely because it carries the lost-update race that
-- credit_gold was written to close. Paying duel pots through it would
-- reintroduce that race on the one path where two writers (both players'
-- clients, plus an expiry sweep) genuinely can settle the same match at once.
--
-- So: the same select-for-update-then-qualified-UPDATE body as spend_gold and
-- credit_gold, with `where id = p_profile_id` in place of
-- `where session_token = p_token`. Deliberately NOT a refactor of the existing
-- four into a shared helper -- those are live, they move real Gold, and the
-- migrations here are append-only, so a shared body would mean re-issuing
-- working functions to add a caller that does not need them to change.
--
-- The unlimited-Gold handling is copied exactly, and must stay copied: an
-- unlimited profile is never charged, so crediting one would mint Gold on
-- every cycle. In a duel that is sharper than elsewhere -- an unlimited player
-- antes nothing and would otherwise be paid a pot they did not fund.

create or replace function public.spend_gold_by_profile(p_profile_id uuid, p_amount integer)
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
  where p.id = p_profile_id
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
    where id = p_profile_id
    returning public.profiles.gold_balance into v_balance;
  end if;

  return query select true, v_balance;
end;
$$;

create or replace function public.credit_gold_by_profile(p_profile_id uuid, p_amount integer)
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
  where p.id = p_profile_id
  for update;

  if not found then
    return query select false, 0;
    return;
  end if;

  if not v_unlimited then
    update public.profiles
    set gold_balance = public.profiles.gold_balance + p_amount,
        updated_at = now()
    where id = p_profile_id
    returning public.profiles.gold_balance into v_balance;
  end if;

  return query select true, v_balance;
end;
$$;

-- Same posture as every other Gold function: the service role is the only
-- caller. These take a profile id rather than a session token, so an exposed
-- grant here would let any authenticated client move Gold between arbitrary
-- accounts -- strictly worse than the token-keyed ones, where a caller can at
-- least only reach their own row.
revoke all on function public.spend_gold_by_profile(uuid, integer) from public, anon, authenticated;
revoke all on function public.credit_gold_by_profile(uuid, integer) from public, anon, authenticated;
grant execute on function public.spend_gold_by_profile(uuid, integer) to service_role;
grant execute on function public.credit_gold_by_profile(uuid, integer) to service_role;
