-- Generalizes ante_up_attempts from Sudoku-only to all four brain games
-- (Sudoku, Word Stack, Connections, Memory Match), and retires the flat
-- "Complete one brain game" mission the new per-game daily bonus replaces.
--
-- See CLAUDE.md's 2026-08-21 "Ante Up unified" entry for the product reasoning.

-- ---- ante_up_attempts: add a game discriminator -----------------------
--
-- Sudoku was the only game this table ever served, so `difficulty` was a
-- Sudoku-specific column with a Sudoku-specific CHECK. The other three games
-- have no difficulty axis at all, so it becomes a generic, optional `tier`
-- label instead -- still populated by Sudoku (its four difficulties), null
-- for the rest.
alter table public.ante_up_attempts
  add column game text not null default 'sudoku' check (length(game) between 1 and 40);
alter table public.ante_up_attempts alter column game drop default;

alter table public.ante_up_attempts rename column difficulty to tier;
alter table public.ante_up_attempts alter column tier drop not null;
alter table public.ante_up_attempts drop constraint ante_up_attempts_difficulty_check;
alter table public.ante_up_attempts add constraint ante_up_attempts_tier_check
  check (tier is null or length(tier) between 1 and 20);

comment on column public.ante_up_attempts.game is
  'Which brain game this attempt belongs to (sudoku, word-stack, connections, memory-match) -- one player can hold one active attempt PER GAME, not one globally.';
comment on column public.ante_up_attempts.tier is
  'Sudoku''s difficulty (easy/medium/hard/expert). Null for games with no difficulty axis -- their multiplier comes from in-round performance instead, scored at settlement.';

-- One live attempt per player PER GAME. A global "one attempt, period" index
-- was correct when Sudoku was the only game here; with four games running
-- this mechanic concurrently, that same index would block a player's Word
-- Stack attempt because they have a Connections attempt open.
drop index public.ante_up_attempts_one_active_per_player;
create unique index ante_up_attempts_one_active_per_game
  on public.ante_up_attempts(profile_id, game)
  where status = 'active';

-- The daily wagered-attempt cap (ANTE_UP_DAILY_WAGERED_LIMIT) becomes
-- per-game rather than one pool shared by all four -- confirmed with the
-- product owner: preserves what Sudoku Ante Up players already had, rather
-- than quietly cutting their ceiling the day three more games start sharing
-- the same counter.
drop index public.ante_up_attempts_wagered_recent_idx;
create index ante_up_attempts_wagered_recent_idx
  on public.ante_up_attempts(profile_id, game, created_at desc)
  where wager > 0;

-- ---- retire the flat daily-brain-game mission --------------------------
--
-- Replaced by a per-game skill-scored daily bonus (see
-- lib/server/daily-puzzle-bonus.ts) that pays on each of the four games'
-- own first daily completion, not once across all of them. Disabling, not
-- deleting: player_mission_progress keeps its history, and the catalog
-- already filters on `enabled`, so nothing else needs to change for this
-- mission to stop being offered.
update public.mission_definitions set enabled = false where code = 'daily_brain_game';
