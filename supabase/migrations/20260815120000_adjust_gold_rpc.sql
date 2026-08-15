-- adjustGold (lib/server/profile-store.ts) is the admin Gold-correction tool
-- -- the one path that intentionally bypasses spendGold's unlimited-Gold and
-- insufficient-funds guards, for bug-fix and tournament-prize corrections.
-- It has always been a plain read-then-write: read gold_balance, add the
-- delta (positive or negative), write it back. Every player-facing Gold path
-- closed exactly this race a while ago (spend_gold, credit_gold,
-- spend_gold_by_profile, credit_gold_by_profile all take the row lock first);
-- this admin tool never got the same treatment, so two concurrent admin
-- corrections on the same profile can still race on a stale read and drop one
-- delta. Low-frequency, admin-only, HMAC-gated -- but it moves real Gold, and
-- the fix is the same three lines as everywhere else in this file.
--
-- Deliberately does NOT special-case unlimited_gold the way spend/credit_gold
-- do -- adjustGold's whole point is to be the one path that ignores that
-- flag, per its own doc comment.

create or replace function public.adjust_gold_by_profile(p_profile_id uuid, p_delta integer)
returns table (success boolean, gold_balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'Invalid Gold adjustment' using errcode = '22023';
  end if;

  update public.profiles
  set gold_balance = greatest(0, public.profiles.gold_balance + p_delta),
      updated_at = now()
  where id = p_profile_id
  returning public.profiles.gold_balance into v_balance;

  if not found then
    return query select false, 0;
    return;
  end if;

  return query select true, v_balance;
end;
$$;

-- Same posture as every other Gold function: service role only. This one
-- takes a profile id with no funds check at all, so an exposed grant would
-- let any authenticated client mint or destroy Gold on any account.
revoke all on function public.adjust_gold_by_profile(uuid, integer) from public, anon, authenticated;
grant execute on function public.adjust_gold_by_profile(uuid, integer) to service_role;
