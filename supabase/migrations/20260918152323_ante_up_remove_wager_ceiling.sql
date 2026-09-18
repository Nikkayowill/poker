-- Removes the Ante Up wager ceiling added by 20260827090000 and extended by
-- 20260901090000. Kayo wants a solo wager bounded only by the player's own
-- balance, same as every other stake in the app -- no per-difficulty cap.
--
-- This reopens the restake-a-near-certain-win exploit those migrations were
-- written to close (see 20260827090000's header for the mechanics). That is
-- an accepted tradeoff, not an oversight: the ANTE_UP_TIERS payout multipliers
-- (lib/arcade/ante-up.ts) still cap how much a single win pays out, and the
-- daily wagered-attempt caps still bound how many attempts a day can run.
--
-- Keeping the trigger (rather than dropping it) so a future ceiling has
-- somewhere to land without a new migration re-adding the plumbing; it just
-- never fires now.

create or replace function public.ante_up_attempts_enforce_wager_ceiling()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  return new;
end;
$$;

comment on function public.ante_up_attempts_enforce_wager_ceiling() is
  'No-op as of 20260918: Ante Up wagers are bounded only by balance. See this migration for why the ceiling was removed.';
