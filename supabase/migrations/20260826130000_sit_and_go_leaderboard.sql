-- Sit & Go joins the win-rate leaderboard pool alongside the other
-- head-to-head games. lib/leaderboard/contract.ts's LEADERBOARD_GAMES
-- registry and this function's own game_id list have to stay hand-in-sync
-- (see 20260824160000_drop_memory_match_leaderboard.sql's header, which
-- restates the same rule when it removed a game rather than adding one) --
-- adding the registry entry alone would leave the board empty forever, since
-- nothing would ever qualify a Sit & Go result into it.
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
      and game_id in ('chess', 'checkers', 'trivia', 'word-race', 'cribbage', 'sit-and-go')
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
