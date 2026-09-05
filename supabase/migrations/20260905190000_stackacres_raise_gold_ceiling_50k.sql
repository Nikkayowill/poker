-- Raise the StackAcres daily Gold ceiling again: 15,000 -> 50,000 per player
-- per UTC day.
--
-- Kayo's call, 2026-09-05. Same reasoning as 20260903130000, which raised it
-- 5,000 -> 15,000 when the Gold market first gave the farm real prices to
-- pay: a maxed capacity ladder and a Cattle Pen (60,000 seed price, priced at
-- 100 Gold/Bushel of that in the market) made 15,000/day too slow a payback
-- to be worth building toward. This is the deliberate migration that
-- function's own comment demanded -- raising the faucet cannot be a config
-- edit, only a schema change somebody had to write and apply.
--
-- WHAT DOES NOT CHANGE, and this is still the whole safety argument:
--
--   * The ceiling is still FLAT. It does not scale with land owned, stock
--     owned, Bushels held, Gold held, or how well anybody traded.
--   * It is still PER PLAYER PER UTC DAY, serialized by the primary key on
--     (profile_id, day).
--   * The database is still the authority. `p_ceiling` can still only TIGHTEN
--     the limit, so a bug or a bad deploy in TypeScript can lower this but
--     never raise it.
--
-- THE HONEST ARITHMETIC: up to ~18.25M a year for somebody who maxes it every
-- single day and never misses -- still flat and per-player, so a thousand
-- players cannot each take more than one can.
--
-- Keep in step with STACKACRES_GOLD_CEILING in lib/stackacres/exchange.ts.
-- Duplicated because a function cannot import a TypeScript module; this copy
-- is the one that decides.
--
-- Everything below the ceiling line is byte-identical to 20260903130000. It is
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
  -- 15000 -> 50000. The only line in this function that changed.
  hard_ceiling constant integer := 50000;
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
  'Atomically reserves Gold against a player''s flat daily StackAcres ceiling (50,000/day since 20260905190000). Returns the day''s new total, or NULL when the ceiling refuses -- callers treat NULL as a lost race and never pay on it. Carries its own hard ceiling; the p_ceiling argument can only tighten it.';

-- Re-revoked because `create or replace function` resets nothing about
-- privileges on a NEW function and this one may be recreated on a fresh
-- database where it does not exist yet. `public` is listed explicitly and is
-- the one that matters: omitting it leaves the function anonymously callable,
-- which has shipped as a silent no-op twice in this repo.
revoke execute on function public.reserve_homestead_exchange(uuid, date, integer, integer)
  from public, anon, authenticated;
