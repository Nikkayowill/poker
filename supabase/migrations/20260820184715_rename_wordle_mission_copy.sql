-- The daily-wordle catalog entry was renamed to daily-word-stack (Wordle is
-- someone else's trademark); this mission's description named the old game
-- by name. Data-only: the seed insert in 20260814120000_missions.sql stays
-- as written since migrations are append-only, so the correction lands here.

update public.mission_definitions
set description = 'Finish a Word Stack, Sudoku, Connections or Memory round.'
where code = 'daily_brain_game';
