-- Ante Up: a wager ceiling that climbs with the board's difficulty.
--
-- Until now `wager` was bounded only by `wager >= 0` and the player's own
-- balance. Combined with an easy board being close to a certain win, the
-- safest rung of every ladder was the best place to put a fortune: stake
-- everything on a grid you always solve, collect a multiple, restake the
-- larger balance. The daily wagered-attempt caps limited how many times a day
-- that ran, not how large each run was, and compounding did the rest.
--
-- The authority for this rule is lib/arcade/ante-up-stakes.ts, which every
-- open*Attempt service calls before any Gold moves. What follows is the
-- backstop underneath it, so the rule is true of the data and not merely of
-- the code path that happens to write it.
--
-- WHY A TRIGGER AND NOT A CHECK CONSTRAINT
--
-- A CHECK is the obvious tool and it is the wrong one here. A CHECK is
-- re-evaluated on every UPDATE of the row, not only on INSERT, and `NOT VALID`
-- does not change that -- it skips the one-time scan of existing rows and
-- nothing else. Every settlement in this subsystem is an UPDATE
-- (lib/server/ante-up-store.ts's advanceAnteUpAttempt), and that function
-- throws on a database error rather than returning null. So a single attempt
-- opened before this migration lands, at a wager the new ceiling forbids,
-- would become unsettleable: every read of it raises, the page 500s on every
-- load, and ante_up_attempts_one_active_per_game blocks the player from ever
-- opening another attempt at that game -- with their stake already debited.
-- The old wager quick-picks went up to 10,000 and the new sudoku/easy ceiling
-- is 5,000, so that is an ordinary attempt, not a contrived one.
--
-- A BEFORE INSERT trigger says exactly what is meant: a stake may not be
-- OPENED above its board's ceiling. It cannot interfere with settling one
-- that already exists.

create or replace function public.ante_up_attempts_enforce_wager_ceiling()
returns trigger
language plpgsql
as $$
declare
  ceiling integer;
begin
  -- Keep these in step with lib/arcade/ante-up-stakes.ts. They are duplicated
  -- on purpose -- a trigger cannot import a TypeScript module -- and a retune
  -- that moves one without the other turns a permitted wager into a 500 from
  -- the database instead of a clean 400 from the service.
  ceiling := case
    when new.game = 'sudoku' and new.tier = 'easy' then 5000
    when new.game = 'sudoku' and new.tier = 'medium' then 25000
    when new.game = 'sudoku' and new.tier = 'hard' then 100000
    when new.game = 'sudoku' and new.tier = 'expert' then 500000
    when new.game = 'minesweeper' and new.tier = 'beginner' then 5000
    when new.game = 'minesweeper' and new.tier = 'intermediate' then 50000
    when new.game = 'minesweeper' and new.tier = 'expert' then 500000
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
  'A bigger stake has to buy a harder board. Mirrors lib/arcade/ante-up-stakes.ts. INSERT-only on purpose: see the migration that added it for why a CHECK constraint would brick in-flight attempts.';

drop trigger if exists ante_up_attempts_wager_ceiling on public.ante_up_attempts;
create trigger ante_up_attempts_wager_ceiling
  before insert on public.ante_up_attempts
  for each row
  execute function public.ante_up_attempts_enforce_wager_ceiling();
