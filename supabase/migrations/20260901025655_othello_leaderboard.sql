-- Othello joins the win/loss leaderboard pool, per the standing rule: every
-- PvP game gets a board (lib/leaderboard/contract.ts's own header).
-- global_leaderboard_entries() has to name it explicitly in its own SQL --
-- adding the registry entry in contract.ts alone would open the "Othello" tab
-- and start the writes, but leave the Global blend blind to it, the same gap
-- 20260826174143_heads_up_leaderboard.sql closed for heads-up. That
-- migration's own comment points back at contract.ts; this one does too.
--
-- Built on that migration's game_id list rather than an older draft of it, for
-- the reason it records about its own predecessor: redefining this function
-- from a stale list silently drops whatever was added in between back out of
-- the Global blend. Adds 'othello' only. get_global_leaderboard() is not
-- recreated -- it reads this function by name and picks the change up on its
-- own.

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
      and game_id in ('chess', 'checkers', 'othello', 'trivia', 'word-race', 'cribbage', 'sit-and-go', 'heads-up')
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
