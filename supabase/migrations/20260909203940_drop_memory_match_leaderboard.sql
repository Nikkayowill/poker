-- Memory Match is a solo game, and solo games do not get a leaderboard.
--
-- The rule, settled with Kayo while building Ante Up: Minesweeper: every PvP
-- game gets a board, poker keeps its own richer one (hands won, biggest pot,
-- not just W/L), and Ante Up solo games get none. Memory Match predates that
-- rule and was the only game contradicting it.
--
-- This is the half the code cannot do on its own. Dropping the registry entry
-- in lib/leaderboard/contract.ts removes the tab and stops the writes, but
-- global_leaderboard_entries() names 'memory-match' in its own SQL, so a
-- code-only removal would leave the Global blend still folding a hidden
-- board's percentiles into everyone's global score -- a board no one can open
-- and no one can be shown their standing on.
--
-- With that branch gone, the whole `metric_sum / metric_count` (lower-is-
-- better) pool has no members. It is removed here rather than left as an
-- empty union arm for the same reason the application-side average-metric
-- code goes with it: an arm that can never match is something a reader has to
-- disprove. `game_leaderboard_stats` keeps both columns -- migrations are
-- append-only here, and dropping a column to delete zeroes is not worth the
-- rewrite. The `higher_better` flag and the case that reads it DO stay, even
-- though every surviving row now sets it true: that is the pool's generic
-- scoring rule, not a branch belonging to the game being removed, and the
-- next game that ranks low-to-high sets it and needs nothing else.
--
-- Existing memory-match ROWS are deliberately left in place, not deleted.
-- They are inert the moment this function stops naming the game (nothing
-- reads game_leaderboard_stats except by an id the registry knows), and they
-- are the only record of those clears. Same call as the retired casino games'
-- orphaned arcade_rounds rows.
--
-- get_global_leaderboard() is unchanged and is not recreated here: it reads
-- global_leaderboard_entries() by name, so it picks this up on its own.

create or replace function public.global_leaderboard_entries()
returns table (profile_id uuid, game_id text, percentile numeric)
language sql
stable
set search_path = public
as $$
  with pooled as (
    select profile_id, 'poker'::text as game_id, total_chips_won::numeric as score, true as higher_better
    from public.player_stats
    where hands_played >= 20
    union all
    select profile_id, game_id, (wins::numeric / nullif(wins + losses + draws, 0)) as score, true
    from public.game_leaderboard_stats
    where wins + losses + draws >= 3
      and game_id in ('chess', 'checkers', 'trivia', 'word-race', 'cribbage')
  )
  select
    profile_id,
    game_id,
    case
      when higher_better then percent_rank() over (partition by game_id order by score asc)
      else percent_rank() over (partition by game_id order by score desc)
    end as percentile
  from pooled;
$$;
