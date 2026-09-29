-- Nonogram shipped (2026-08-31) with a wager ceiling in
-- lib/arcade/ante-up-stakes.ts but no matching entry in the DB-side backstop
-- added by 20260827090000_ante_up_wager_tier_ceiling.sql. That trigger fails
-- open for any game/tier it doesn't recognise -- deliberately, so a new game
-- isn't rejected by a rule written before it existed -- which meant Nonogram
-- wagers had exactly one enforcement point (the TypeScript check) instead of
-- two. This closes that gap the same way the original migration's own
-- comment said to: add the game here, second, now that it exists.
--
-- Ceilings mirror NONOGRAM_MAX_WAGER in lib/arcade/ante-up-stakes.ts exactly.
-- Keep them in step by hand -- see that trigger's own header for why this is
-- a duplicated case list rather than a shared source of truth.
--
-- Also picks up `set search_path = public`, which the original 2026-08-27
-- migration left off this one function while every guarded RPC elsewhere in
-- this codebase (spend_gold, credit_gold, ...) sets it -- a drive-by fix
-- since this function is being redefined here anyway; flagged by
-- get_advisors as function_search_path_mutable.

create or replace function public.ante_up_attempts_enforce_wager_ceiling()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  ceiling integer;
begin
  ceiling := case
    when new.game = 'sudoku' and new.tier = 'easy' then 5000
    when new.game = 'sudoku' and new.tier = 'medium' then 25000
    when new.game = 'sudoku' and new.tier = 'hard' then 100000
    when new.game = 'sudoku' and new.tier = 'expert' then 500000
    when new.game = 'minesweeper' and new.tier = 'beginner' then 5000
    when new.game = 'minesweeper' and new.tier = 'intermediate' then 50000
    when new.game = 'minesweeper' and new.tier = 'expert' then 500000
    when new.game = 'nonogram' and new.tier = 'easy' then 5000
    when new.game = 'nonogram' and new.tier = 'medium' then 25000
    when new.game = 'nonogram' and new.tier = 'hard' then 100000
    when new.game = 'nonogram' and new.tier = 'expert' then 250000
    when new.game = 'nonogram' and new.tier = 'master' then 500000
    when new.game = 'memory-match' then 25000
    -- Any game/tier pair not listed yields NULL and is left alone. That
    -- fail-open default is deliberate: a game added to this table later must
    -- not have every insert rejected by a rule written before it existed. Its
    -- ceiling belongs in ante-up-stakes.ts first and here second. (word-stack
    -- and connections are absent because they never write to this table --
    -- their wager rides on a daily_puzzle_rounds row.)
    else null
  end;

  if ceiling is not null and new.wager > ceiling then
    raise exception
      'Ante Up wager % exceeds the ceiling of % for game % at tier %',
      new.wager, ceiling, new.game, coalesce(new.tier, '(none)')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.ante_up_attempts_enforce_wager_ceiling() is
  'A bigger stake has to buy a harder board. Mirrors lib/arcade/ante-up-stakes.ts. INSERT-only on purpose: see 20260827090000 for why a CHECK constraint would brick in-flight attempts.';
