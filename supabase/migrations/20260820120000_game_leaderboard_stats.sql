-- A reusable per-game leaderboard, generalized off the poker-only
-- leaderboard (20260728195100_leaderboards_and_seasons.sql). player_stats /
-- season_stats stay exactly as they are -- proven, idempotent via
-- hand_results, carrying poker-only columns like vpip_hands that don't
-- generalize. Poker becomes a read-side score source for the Global
-- leaderboard only (see get_global_leaderboard below); this table is never
-- written for game_id = 'poker'.
--
-- One row per (profile, game), generic enough that dropping in a future
-- game needs no schema change: raw accumulators only, never a derived
-- number. An average (Memory Match's turns-to-clear) is metric_sum /
-- metric_count computed at read time, the same reason player_stats never
-- stores a win rate.

create table public.game_leaderboard_stats (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- Free text, matched by lib/leaderboard/contract.ts's registry, same "a
  -- migration and a row, not a migration that also alters a type" reasoning
  -- mission_definitions.metric restates. 'chess' | 'checkers' | 'trivia' |
  -- 'word-race' | 'cribbage' | 'memory-match' today.
  game_id text not null,
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  draws integer not null default 0 check (draws >= 0),
  -- Only meaningful for an average-metric game (Memory Match's turns). Zero
  -- for a win/loss-record game.
  metric_sum bigint not null default 0,
  metric_count integer not null default 0 check (metric_count >= 0),
  -- Signed: positive is an active win streak, negative an active loss
  -- streak, zero after a draw or before any result.
  current_streak integer not null default 0,
  best_streak integer not null default 0 check (best_streak >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, game_id)
);

create index game_leaderboard_stats_game_idx on public.game_leaderboard_stats (game_id);

comment on table public.game_leaderboard_stats is
  'Per-game leaderboard accumulators for every non-poker game. Mirrored in memory mode by lib/server/leaderboard-store.ts, same duplication every memory-mode store here carries.';

-- ---------------------------------------------------------------------------
-- apply_leaderboard_result: one row-locked RPC, same insert...on conflict...
-- do update shape as apply_achievement_counter -- that statement is itself
-- the row lock, no separate SELECT...FOR UPDATE needed. Exactly one of
-- p_win/p_loss/p_draw may be true (a metric-only call like Memory Match's
-- passes all three false).
-- ---------------------------------------------------------------------------

create or replace function public.apply_leaderboard_result(
  p_profile_id uuid,
  p_game_id text,
  p_win boolean,
  p_loss boolean,
  p_draw boolean,
  p_metric_delta bigint default 0,
  p_metric_count_delta integer default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (p_win::int + p_loss::int + p_draw::int) > 1 then
    raise exception 'Invalid leaderboard result' using errcode = '22023';
  end if;

  insert into public.game_leaderboard_stats (
    profile_id, game_id, wins, losses, draws, metric_sum, metric_count,
    current_streak, best_streak, updated_at
  ) values (
    p_profile_id, p_game_id,
    case when p_win then 1 else 0 end,
    case when p_loss then 1 else 0 end,
    case when p_draw then 1 else 0 end,
    coalesce(p_metric_delta, 0), coalesce(p_metric_count_delta, 0),
    case when p_win then 1 when p_loss then -1 else 0 end,
    case when p_win then 1 else 0 end,
    now()
  )
  on conflict (profile_id, game_id) do update set
    wins = public.game_leaderboard_stats.wins + case when p_win then 1 else 0 end,
    losses = public.game_leaderboard_stats.losses + case when p_loss then 1 else 0 end,
    draws = public.game_leaderboard_stats.draws + case when p_draw then 1 else 0 end,
    metric_sum = public.game_leaderboard_stats.metric_sum + coalesce(p_metric_delta, 0),
    metric_count = public.game_leaderboard_stats.metric_count + coalesce(p_metric_count_delta, 0),
    current_streak = case
      when p_win then greatest(public.game_leaderboard_stats.current_streak, 0) + 1
      when p_loss then least(public.game_leaderboard_stats.current_streak, 0) - 1
      when p_draw then 0
      else public.game_leaderboard_stats.current_streak
    end,
    best_streak = greatest(
      public.game_leaderboard_stats.best_streak,
      case
        when p_win then greatest(public.game_leaderboard_stats.current_streak, 0) + 1
        else public.game_leaderboard_stats.best_streak
      end
    ),
    updated_at = now();
end;
$$;

revoke all on function public.apply_leaderboard_result(uuid, text, boolean, boolean, boolean, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.apply_leaderboard_result(uuid, text, boolean, boolean, boolean, bigint, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- Global leaderboard: a read-time percentile blend across every game a
-- player qualifies in, computed fresh per request rather than a
-- denormalized column -- a stored "global score" would need recomputing on
-- every OTHER player's write in the same game (percentiles shift even when
-- you didn't play), which forces a scheduled recompute job. This app's
-- Realtime posture already caps concurrency around ~3,000 and the
-- leaderboard page is not polled per-second, so a window-function scan over
-- a few thousand rows per game comfortably fits inside a request.
--
-- Percentiles are unit-free, which is what makes Gold won, win rate and
-- average turns directly comparable without a hand-tuned point conversion.
-- minSample gates a 1-0 record or a two-turn Memory clear from posting a
-- perfect 1.0; the thresholds here must stay hand-in-sync with
-- lib/leaderboard/contract.ts's minSample values -- comment on both sides
-- points at the other.
-- ---------------------------------------------------------------------------

create or replace function public.global_leaderboard_entries()
returns table (profile_id uuid, game_id text, percentile numeric)
language sql
stable
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
as $$
  with per_profile as (
    select profile_id, avg(percentile) as global_score, count(*)::integer as games_counted
    from public.global_leaderboard_entries()
    group by profile_id
  )
  select profile_id, global_score, games_counted, rank() over (order by global_score desc)::integer as rank
  from per_profile;
$$;

-- ---------------------------------------------------------------------------
-- Access. Same posture as player_stats: unlike a Gold-bearing table,
-- leaderboard standing is public by nature, so anon/authenticated get a
-- read grant even though app/api/leaderboard today always reads through the
-- service-role client. Writes stay service_role-only via the RPC above.
-- ---------------------------------------------------------------------------

alter table public.game_leaderboard_stats enable row level security;
revoke all on public.game_leaderboard_stats from public, anon, authenticated;
grant select on public.game_leaderboard_stats to anon, authenticated;
