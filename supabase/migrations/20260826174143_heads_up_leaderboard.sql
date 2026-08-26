-- Heads-up poker joins the win/loss leaderboard pool, per the standing rule:
-- every PvP game gets a board (lib/leaderboard/contract.ts's own header).
-- global_leaderboard_entries() has to name it explicitly in its own SQL --
-- adding the registry entry in contract.ts alone would open the "Heads-Up"
-- tab and start the writes, but leave the Global blend blind to it, same
-- gap the memory-match removal (20260824160000) closed in the other
-- direction. That migration's own comment points back at contract.ts; this
-- one does too.
--
-- Built on top of 20260826174040_sit_and_go_leaderboard.sql's own game_id
-- list (which landed on origin/main after this migration's id was first
-- picked, and adds 'sit-and-go' to the same list this one already touches)
-- rather than this migration's own earlier draft -- redefining the function
-- from an older list would silently drop 'sit-and-go' back out of the Global
-- blend the moment this migration ran after it. Adds 'heads-up' only.
-- get_global_leaderboard() is not recreated -- it reads this function by
-- name and picks the change up on its own.

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
      and game_id in ('chess', 'checkers', 'trivia', 'word-race', 'cribbage', 'sit-and-go', 'heads-up')
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
