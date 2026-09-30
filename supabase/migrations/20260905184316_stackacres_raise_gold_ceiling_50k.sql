-- Raise the StackAcres daily Gold ceiling: 15,000 -> 50,000 per player per UTC day.
--
-- Kayo's call, 2026-09-05. Cosmetics are expensive so players need higher yields
-- to afford them within a reasonable play session. This follows the same safe
-- pattern as the 5k->15k raise on 2026-09-03: the ceiling is still FLAT, still
-- PER PLAYER PER UTC DAY, and the database is still the authority. A TypeScript
-- bug can lower this but never raise it.
--
-- Keep in step with STACKACRES_GOLD_CEILING in lib/stackacres/exchange.ts.
-- Duplicated because a function cannot import a TypeScript module; this copy
-- is the one that decides.

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
  -- 5000 -> 15000 -> 50000. Updated 2026-09-05.
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
  'Atomically reserves Gold against a player''s flat daily StackAcres ceiling (50,000/day since 20260905150000). Returns the day''s new total, or NULL when the ceiling refuses -- callers treat NULL as a lost race and never pay on it. Carries its own hard ceiling; the p_ceiling argument can only tighten it.';

-- Re-revoked because `create or replace function` resets nothing about
-- privileges on a NEW function and this one may be recreated on a fresh
-- database where it does not exist yet. `public` is listed explicitly and is
-- the one that matters: omitting it leaves the function anonymously callable,
-- which has shipped as a silent no-op twice in this repo.
revoke execute on function public.reserve_homestead_exchange(uuid, date, integer, integer)
  from public, anon, authenticated;
