-- Applied to production on 2026-09-01 without a repo file. Recovered verbatim from
-- supabase_migrations.schema_migrations so the folder matches what prod ran.
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
