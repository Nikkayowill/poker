-- Liar's Dice and Mancala join the win/loss leaderboard pool, same as Othello
-- did in 20260831140000. get_global_leaderboard() reads this function by name
-- and is not recreated.
--
-- Production had drifted: 20260824160000_drop_memory_match_leaderboard was
-- applied there on 2026-09-09, after the othello, sit-and-go and heads-up
-- migrations, and its older list dropped all three from the Global blend.
-- This list is the full current one, so applying it puts them back too.

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
      and game_id in ('chess', 'checkers', 'othello', 'liars-dice', 'mancala', 'trivia', 'word-race', 'cribbage', 'sit-and-go', 'heads-up')
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
