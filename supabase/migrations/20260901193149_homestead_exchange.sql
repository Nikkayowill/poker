-- The Homestead's exchange window: the one valve Gold leaves the farm through.
--
-- Phase 2 made harvests pay produce and produce sell for Bushels, none of which
-- is real money. This is where the farm finally touches the wider economy, and
-- the whole safety argument is one sentence: **the maximum Gold a player can
-- take out of the farm in a day is a flat constant.** Not a percentage, not
-- scaled by land owned, not scaled by how well they traded the market phase 4
-- adds. Skill decides how fast the day's bucket fills; nothing decides how big
-- it is. That is what puts this in the same category as the daily grant and the
-- rewarded-ad faucet rather than the category Ante Up was in when it printed
-- money (see 20260827090000_ante_up_wager_tier_ceiling.sql).
--
-- ONE ROW PER PLAYER PER UTC DAY, holding a running total rather than an
-- append-only ledger of individual exchanges. The total is the thing that has
-- to be checked atomically, and keeping it in the row being locked is what
-- makes the check and the write the same statement.

create table public.homestead_exchanges (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  gold integer not null default 0 check (gold >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, day)
);

comment on table public.homestead_exchanges is
  'Gold each player has taken out of the Homestead per UTC day, against a flat daily ceiling. One row per (profile, day); the primary key is what serializes concurrent exchanges. Service-role only.';

comment on column public.homestead_exchanges.day is
  'UTC calendar day, matching the daily Gold grant and the Ante Up daily gates. One midnight for the whole app.';

alter table public.homestead_exchanges enable row level security;
revoke all on public.homestead_exchanges from anon, authenticated;

-- Reserves Gold against today's ceiling and returns the day's new total, or
-- NULL when the reservation would break the ceiling. NULL is the contract: the
-- caller treats it exactly as it treats a lost guarded write -- nothing was
-- reserved, the Bushels go back, and nothing is paid.
--
-- WHY THIS NEEDS NO ADVISORY LOCK, unlike admob_ssv_receipts_enforce_daily_cap.
-- That one counts rows in a table it is inserting into, so under READ COMMITTED
-- two concurrent triggers can each miss the other's uncommitted row and both
-- pass. Here the number being checked lives IN the row being written, and the
-- conflict target is the primary key -- so the second transaction blocks on the
-- index until the first commits, then takes the DO UPDATE branch and
-- re-evaluates its WHERE against the row as the winner left it. Two requests
-- racing for the last of the day's allowance cannot both take it.
--
-- p_ceiling can only ever TIGHTEN the limit. The hard ceiling below is the
-- authority and it lives here, in the database, on purpose: raising the farm's
-- Gold faucet should cost a deliberate migration, not a config edit or a
-- compromised deploy. Keep it in step with HOMESTEAD_GOLD_CEILING in
-- lib/homestead/exchange.ts -- duplicated because a function cannot import a
-- TypeScript module, the same tension the wager-ceiling trigger names.
create or replace function public.reserve_homestead_exchange(
  p_profile_id uuid,
  p_day date,
  p_gold integer,
  p_ceiling integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  hard_ceiling constant integer := 5000;
  ceiling integer := least(coalesce(p_ceiling, hard_ceiling), hard_ceiling);
  next_gold integer;
begin
  -- A zero or negative reservation is not a refusal, it is a caller bug: it
  -- would hand back a non-null total and so authorise a payout that reserved
  -- nothing. Raise rather than return null, so it cannot be mistaken for a
  -- full day.
  if p_gold is null or p_gold <= 0 then
    raise exception 'Homestead exchange amount must be positive, got %', p_gold
      using errcode = 'check_violation';
  end if;

  -- A single request larger than the whole day's allowance never fits, and the
  -- insert branch below has no WHERE clause to catch it.
  if p_gold > ceiling then
    return null;
  end if;

  insert into public.homestead_exchanges as e (profile_id, day, gold)
  values (p_profile_id, p_day, p_gold)
  on conflict (profile_id, day) do update
    set gold = e.gold + p_gold,
        updated_at = now()
    where e.gold + p_gold <= ceiling
  returning e.gold into next_gold;

  -- No row came back: the DO UPDATE's WHERE refused, so today is spent.
  return next_gold;
end;
$$;

comment on function public.reserve_homestead_exchange(uuid, date, integer, integer) is
  'Atomically reserves Gold against a player''s flat daily Homestead ceiling. Returns the day''s new total, or NULL when the ceiling refuses -- callers treat NULL as a lost race and never pay on it. Carries its own hard ceiling; the p_ceiling argument can only tighten it.';

-- `public` is load-bearing and not redundant: anon and authenticated inherit
-- Postgres's default PUBLIC execute grant, so revoking from the two roles alone
-- leaves the function callable on /rest/v1/rpc. This one is SECURITY DEFINER
-- and takes the profile id as a parameter rather than reading the caller's
-- session, so an anonymous caller reaching it could burn any player's daily
-- allowance -- or, worse, a caller who also reached the inventory RPC could
-- pair the two. All three names matter. Verify with proacl afterwards rather
-- than by re-reading this file; a correct one has no bare `=X/postgres` entry,
-- and get_advisors catches the SECURITY DEFINER case.
revoke all on function public.reserve_homestead_exchange(uuid, date, integer, integer) from public, anon, authenticated;
