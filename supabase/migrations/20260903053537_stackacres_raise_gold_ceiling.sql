-- Raise the StackAcres daily Gold ceiling: 5,000 -> 15,000 per player per UTC day.
--
-- Kayo's call, 2026-09-03. This is the migration the original function's own
-- comment demanded: `reserve_homestead_exchange` holds the hard ceiling in the
-- database precisely so that raising the farm's Gold faucet cannot be done by
-- a config edit or a compromised deploy, only by a deliberate schema change
-- somebody had to write and apply. That is what this is.
--
-- WHY IT MOVED. The original 5,000 was sized against the OTHER faucets -- the
-- daily grant at 1,000 x up to a 2.5 streak multiplier, rewarded ads at
-- 500 x 6 = 3,000, the backstop at 1,000 per 12h -- and that was the right
-- comparison at the time, because the farm had nothing to spend Gold on. Every
-- Gold it produced was pure addition to the money supply.
--
-- That is no longer the shape. The Gold market (20260903120000) gave the farm
-- real prices: a Cattle Pen is 60,000 Gold, a Sheep Pen 15,000, a full grid of
-- land 120,000. Anybody actually building a farm is now a large net SINK, and
-- against those prices a 5,000/day outlet made the payback long enough that
-- buying anything at all looked irrational. 15,000 keeps the loop worth
-- running without touching the property that makes it safe.
--
-- WHAT DOES NOT CHANGE, and this is the whole safety argument:
--
--   * The ceiling is still FLAT. It does not scale with land owned, stock
--     owned, Bushels held, Gold held, or how well anybody traded. If a future
--     change makes this number depend on ANYTHING about the player, that is
--     the bug -- it is what separates this from the Ante Up design that
--     printed money.
--   * It is still PER PLAYER PER UTC DAY, serialized by the primary key on
--     (profile_id, day). Two tabs racing for the last of the allowance still
--     cannot both take it.
--   * The database is still the authority. `p_ceiling` can still only TIGHTEN
--     the limit, so a bug or a bad deploy in TypeScript can lower this but
--     never raise it.
--
-- THE HONEST ARITHMETIC, so nobody has to rederive it: this is 3x the Gold per
-- player per day, up to ~5.5M a year for somebody who maxes it every single
-- day and never misses. What bounds the damage is that it is flat and
-- per-player -- a thousand players cannot each take more than one can, and no
-- amount of farm makes any one of them take more than another.
--
-- Keep in step with STACKACRES_GOLD_CEILING in lib/stackacres/exchange.ts.
-- Duplicated because a function cannot import a TypeScript module; this copy
-- is the one that decides.
--
-- Everything below the ceiling line is byte-identical to 20260901190000. It is
-- restated rather than patched because `create or replace function` has no way
-- to change one line of a body -- so read the diff against that file, not this
-- one in isolation.

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
  -- 5000 -> 15000. The only line in this function that changed.
  hard_ceiling constant integer := 15000;
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
  'Atomically reserves Gold against a player''s flat daily StackAcres ceiling (15,000/day since 20260903130000). Returns the day''s new total, or NULL when the ceiling refuses -- callers treat NULL as a lost race and never pay on it. Carries its own hard ceiling; the p_ceiling argument can only tighten it.';

-- Re-revoked because `create or replace function` resets nothing about
-- privileges on a NEW function and this one may be recreated on a fresh
-- database where it does not exist yet. `public` is listed explicitly and is
-- the one that matters: omitting it leaves the function anonymously callable,
-- which has shipped as a silent no-op twice in this repo.
revoke execute on function public.reserve_homestead_exchange(uuid, date, integer, integer)
  from public, anon, authenticated;
