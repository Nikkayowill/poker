-- Closes a race in admob_ssv_receipts's daily cap: two SSV callbacks for the
-- same profile, delivered close together, could both read the day's count
-- before either had inserted its own row, so both would pass a
-- check-then-insert and the profile ends up credited above
-- ADMOB_REWARDED_AD_DAILY_LIMIT for that UTC day. The application-level check
-- in admob-ssv-service.ts is still there as a cheap early exit; this trigger
-- is the actual guarantee, the same relationship the wager ceiling below
-- has to lib/arcade/ante-up-stakes.ts's own check.
--
-- WHY A TRIGGER, AND WHY AN ADVISORY LOCK
--
-- Same reasoning as ante_up_attempts_enforce_wager_ceiling
-- (20260827090000_ante_up_wager_tier_ceiling.sql): a BEFORE INSERT trigger,
-- not a CHECK, because this only needs to gate what gets OPENED (a new
-- receipt), never interferes with anything already recorded, and a CHECK
-- constraint re-evaluates on every UPDATE too, which this table has no
-- reason to invite.
--
-- A plain "count, then compare" inside the trigger is not enough by itself --
-- under the default READ COMMITTED isolation, two concurrent INSERTs into
-- this table each run their own BEFORE INSERT trigger in their own
-- transaction, and neither sees the other's uncommitted row, so both could
-- still count 5 when the limit is 6 and both proceed. pg_advisory_xact_lock,
-- keyed by profile_id, forces one of the two triggers to wait for the other's
-- transaction to finish (commit or rollback) before it can even run its own
-- count -- so the second one always sees the first's row. The lock is
-- transaction-scoped (auto-released at commit/rollback), so it cannot leak
-- across requests or outlive a crashed connection the way an explicit
-- unlock-required lock could.

-- set search_path pins this function against a role-mutable search_path
-- (the existing ante_up_attempts_enforce_wager_ceiling trigger predates that
-- hardening and still carries the advisor's function_search_path_mutable
-- warning -- not repeating it here rather than copying it forward).
create or replace function public.admob_ssv_receipts_enforce_daily_cap()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  -- Keep in step with ADMOB_REWARDED_AD_DAILY_LIMIT in lib/rewards/config.ts.
  -- Duplicated on purpose -- a trigger cannot import a TypeScript module --
  -- same tension ante_up_attempts_enforce_wager_ceiling's own comment names.
  daily_limit constant integer := 6;
  claimed_today integer;
  day_start timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext(new.profile_id::text));

  day_start := date_trunc('day', new.verified_at at time zone 'utc') at time zone 'utc';
  select count(*) into claimed_today
    from public.admob_ssv_receipts
    where profile_id = new.profile_id
      and verified_at >= day_start;

  if claimed_today >= daily_limit then
    raise exception
      'Daily AdMob reward limit (%) reached for profile %',
      daily_limit, new.profile_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.admob_ssv_receipts_enforce_daily_cap() is
  'Serializes concurrent SSV callbacks for one profile (advisory xact lock) before counting today''s claims, so the daily cap holds under a race, not just in the common case. Mirrors lib/rewards/config.ts''s ADMOB_REWARDED_AD_DAILY_LIMIT.';

drop trigger if exists admob_ssv_receipts_daily_cap on public.admob_ssv_receipts;
create trigger admob_ssv_receipts_daily_cap
  before insert on public.admob_ssv_receipts
  for each row
  execute function public.admob_ssv_receipts_enforce_daily_cap();
