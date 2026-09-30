-- global_leaderboard_entries / get_global_leaderboard (20260820120000) shipped
-- without `set search_path`, the only two functions in this schema that do --
-- every other one, back to 20260809044511_harden_public_function_privileges,
-- pins it. Supabase's own linter flags both (function_search_path_mutable).
--
-- Lower severity than the usual case for this lint: neither is `security
-- definer`, so a hijacked `public.player_stats` would resolve under the
-- CALLER's rights, not the owner's, and today the only caller is the
-- service-role client in app/api/leaderboard. But "an unqualified name in a
-- function body resolves against whatever search_path the session happens to
-- carry" is not a property worth leaving to the caller, and the fix is the one
-- line every sibling function already has.
--
-- Bodies are otherwise byte-identical to 20260820120000's. Recreated in full
-- rather than ALTER ... SET, so the current definition of each function is
-- readable in one place -- same reason every RPC in this schema is shipped as
-- a whole `create or replace` even for a one-line change.

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
    union all
    select profile_id, game_id, (metric_sum::numeric / nullif(metric_count, 0)) as score, false
    from public.game_leaderboard_stats
    where metric_count >= 3
      and game_id = 'memory-match'
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

create or replace function public.get_global_leaderboard()
returns table (profile_id uuid, global_score numeric, games_counted integer, rank integer)
language sql
stable
set search_path = public
as $$
  with per_profile as (
    select profile_id, avg(percentile) as global_score, count(*)::integer as games_counted
    from public.global_leaderboard_entries()
    group by profile_id
  )
  select profile_id, global_score, games_counted, rank() over (order by global_score desc)::integer as rank
  from per_profile;
$$;
