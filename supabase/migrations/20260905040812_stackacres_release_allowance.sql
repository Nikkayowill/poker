-- StackAcres: hand back daily allowance a harvest reserved and did not use.
--
-- WHY THIS EXISTS. StackAcres is single-currency now: a harvest values itself
-- and pays Gold in one act, under the same flat daily ceiling the exchange
-- window used to sit in front of. To make that ceiling refuse KINDLY, a
-- harvest reserves against it BEFORE it settles any unit -- a full day
-- discovered after the crops are already gone would consume a harvest and pay
-- nothing for it, and the player would have no way to get those crops back.
--
-- The price of reserving first is that a sweep which then loses a race to a
-- second tab has over-reserved. Without a way to give the difference back, a
-- double-tapped Harvest button would quietly burn a player's whole day.
--
-- WHAT DOES NOT CHANGE, and it is the whole safety argument: the ceiling
-- inside `reserve_homestead_exchange` is untouched -- still 15,000, still
-- flat, still per player per UTC day, still the database's own authority that
-- application code can tighten but never raise. Nothing here can raise it
-- either: this function only ever SUBTRACTS and is floored at zero, so the
-- worst a bug or a hostile caller could do is hand a player back allowance
-- they had already used, which is bounded by that same daily constant.
--
-- LAND MAINTENANCE NEEDS NOTHING HERE. It reuses `homestead_upkeep` and
-- `raise_homestead_upkeep` from 20260904130000 exactly as they are; only the
-- currency the number is denominated in changed, and the column keeps its
-- name for the same reason every other `homestead_*` object does.

create or replace function public.release_homestead_exchange(
  p_profile_id uuid,
  p_day date,
  p_gold integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_gold integer;
begin
  -- CLAMPED, NOT RAISED, and that is the opposite posture to
  -- `reserve_homestead_exchange`, which raises on a non-positive amount so a
  -- no-op can never be mistaken for a successful reservation. A release runs
  -- AFTER a harvest has already settled and already been paid, so it must
  -- never throw on top of that.
  if p_gold is null or p_gold <= 0 then
    return null;
  end if;

  update public.homestead_exchanges as e
    set gold = greatest(0, e.gold - p_gold),
        updated_at = now()
  where e.profile_id = p_profile_id
    and e.day = p_day
  returning e.gold into next_gold;

  -- No row: nothing was reserved today to hand back. Not an error -- the
  -- caller is best-effort and has already paid the player correctly.
  return next_gold;
end;
$$;

comment on function public.release_homestead_exchange(uuid, date, integer) is
  'Returns unused StackAcres daily allowance after a harvest settled fewer units than it reserved for. Only ever subtracts, floored at zero, so it can never widen the flat daily ceiling.';

-- `public` is load-bearing and not redundant: anon and authenticated inherit
-- Postgres's default PUBLIC execute grant, so revoking from the two roles alone
-- leaves the function callable on /rest/v1/rpc. This one is SECURITY DEFINER
-- and takes the profile id as a parameter rather than reading the caller's
-- session, so an anonymous caller reaching it could hand any player back their
-- spent allowance. Omitting `public` has shipped as a silent no-op twice in
-- this repo. Verify with proacl afterwards rather than by re-reading this file.
revoke execute on function public.release_homestead_exchange(uuid, date, integer)
  from public, anon, authenticated;
