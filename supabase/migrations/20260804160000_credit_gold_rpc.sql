-- creditGold's Supabase path (lib/server/profile-store.ts) has always been a
-- plain read-then-write: read gold_balance, add the amount, write it back.
-- spendGold closed exactly this race for the deduct path in
-- 20260727180000_fix_ambiguous_gold_balance.sql (a guarded `spend_gold` RPC,
-- FOR UPDATE then a conditional UPDATE) but the credit path was never given
-- the same treatment. Two concurrent credits to the same token -- a rebuy
-- refund racing a cash-out credit, or two browser tabs -- can both read the
-- same stale balance, and the second write silently drops the first: a
-- lost-update under-credit, not the "only ever over-refund in the player's
-- favor" the surrounding comment claims. Bot seats now carry deeper,
-- randomized stacks (see randomBotStack in lib/game/engine.ts), so the
-- dollar amount a dropped credit could cost went up along with them.
--
-- Mirrors spend_gold and claim_daily_gold exactly: select ... for update to
-- take the row lock, then a qualified UPDATE, all in the same transaction --
-- so a second concurrent call serializes behind the first instead of racing
-- it on a stale read.

create or replace function public.credit_gold(p_token uuid, p_amount integer)
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

  -- An unlimited profile is never charged a buy-in, so paying its stack back
  -- out would mint the buy-in on every sit-down/stand-up cycle -- same
  -- reasoning creditGold's caller-side check has always used, just enforced
  -- here too now that the balance read and the write share one lock.
  if not v_unlimited then
    update public.profiles
    set gold_balance = public.profiles.gold_balance + p_amount,
        updated_at = now()
    where session_token = p_token
    returning public.profiles.gold_balance into v_balance;
  end if;

  return query select true, v_balance;
end;
$$;

revoke all on function public.credit_gold(uuid, integer) from public, anon, authenticated;
grant execute on function public.credit_gold(uuid, integer) to service_role;
