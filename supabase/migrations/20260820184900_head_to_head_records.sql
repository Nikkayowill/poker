-- Head-to-head records: "my record against this one person", which no
-- existing table can answer.
--
-- game_leaderboard_stats (20260820120000) totals a player against the whole
-- world, and pvp_matches carries the raw duel rows but only for the two-
-- player games -- cribbage settles somewhere else entirely, and deriving a
-- record by scanning every match a player has ever settled gets slower the
-- more they play. One accumulator row per (me, them, game) instead, written
-- at the same settlement moment the leaderboard row is, so a friends board
-- is three indexed lookups rather than a scan.
--
-- Rows are DIRECTED and stored twice: (me, them) and (them, me) are two
-- rows written by one call, so "my record vs my friends" reads a single
-- primary-key prefix with no or() and no post-query flipping of anyone's
-- wins into losses. The mirror is an invariant, not a coincidence:
-- A.wins vs B always equals B.losses vs A, which is what makes it safe to
-- read only your own side.

create table public.head_to_head_records (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  opponent_id uuid not null references public.profiles(id) on delete cascade,
  -- Same free-text game id as game_leaderboard_stats.game_id, matched by
  -- lib/leaderboard/contract.ts. Only its win/loss-record games ever appear
  -- here: an average-metric game (Memory Match) has no opponent to hold a
  -- record against, and poker is never written here at all -- one pot at a
  -- six-handed table is not a result between two named players.
  game_id text not null,
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  draws integer not null default 0 check (draws >= 0),
  -- Signed, exactly like game_leaderboard_stats.current_streak: positive is
  -- an active win streak against this one opponent, negative a losing one.
  -- This is the number the friends board is really for -- "L5 to her" says
  -- something a 3-8 record does not.
  current_streak integer not null default 0,
  best_streak integer not null default 0 check (best_streak >= 0),
  last_result_at timestamptz not null default now(),
  primary key (profile_id, opponent_id, game_id),
  constraint head_to_head_records_two_players check (profile_id <> opponent_id)
);

-- No secondary index: every read filters profile_id first (optionally with
-- an opponent list), which the primary key's leading column already serves.

comment on table public.head_to_head_records is
  'One row per (player, opponent, game) with that player''s record against that opponent. Written in mirrored pairs by apply_head_to_head_result; mirrored in memory mode by lib/server/head-to-head-store.ts.';

-- ---------------------------------------------------------------------------
-- apply_head_to_head_result: one call, two rows.
--
-- p_outcome is from p_profile_id's side ('win' | 'loss' | 'draw'); the
-- mirrored row is written with the inverse in the same statement, so the two
-- directions cannot drift even if the caller crashes between games. Same
-- insert...on conflict...do update shape as apply_leaderboard_result and
-- apply_achievement_counter -- the statement is itself the row lock.
-- ---------------------------------------------------------------------------

create or replace function public.apply_head_to_head_result(
  p_profile_id uuid,
  p_opponent_id uuid,
  p_game_id text,
  p_outcome text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inverse text;
begin
  if p_outcome not in ('win', 'loss', 'draw') then
    raise exception 'Invalid head-to-head outcome' using errcode = '22023';
  end if;
  if p_profile_id = p_opponent_id then
    raise exception 'A head-to-head result needs two players' using errcode = '22023';
  end if;

  v_inverse := case p_outcome when 'win' then 'loss' when 'loss' then 'win' else 'draw' end;

  insert into public.head_to_head_records as h (
    profile_id, opponent_id, game_id, wins, losses, draws,
    current_streak, best_streak, last_result_at
  )
  values
    (
      p_profile_id, p_opponent_id, p_game_id,
      case when p_outcome = 'win' then 1 else 0 end,
      case when p_outcome = 'loss' then 1 else 0 end,
      case when p_outcome = 'draw' then 1 else 0 end,
      case p_outcome when 'win' then 1 when 'loss' then -1 else 0 end,
      case when p_outcome = 'win' then 1 else 0 end,
      now()
    ),
    (
      p_opponent_id, p_profile_id, p_game_id,
      case when v_inverse = 'win' then 1 else 0 end,
      case when v_inverse = 'loss' then 1 else 0 end,
      case when v_inverse = 'draw' then 1 else 0 end,
      case v_inverse when 'win' then 1 when 'loss' then -1 else 0 end,
      case when v_inverse = 'win' then 1 else 0 end,
      now()
    )
  on conflict (profile_id, opponent_id, game_id) do update set
    wins = h.wins + excluded.wins,
    losses = h.losses + excluded.losses,
    draws = h.draws + excluded.draws,
    -- excluded.current_streak is +1 / -1 / 0, so its sign is the outcome:
    -- extend a run of the same sign, otherwise start a fresh one.
    current_streak = case
      when excluded.current_streak > 0 then greatest(h.current_streak, 0) + 1
      when excluded.current_streak < 0 then least(h.current_streak, 0) - 1
      else 0
    end,
    best_streak = greatest(
      h.best_streak,
      case when excluded.current_streak > 0 then greatest(h.current_streak, 0) + 1 else 0 end
    ),
    last_result_at = now();
end;
$$;

revoke all on function public.apply_head_to_head_result(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_head_to_head_result(uuid, uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Backfill, so a record that already happened shows up the day this ships
-- rather than starting everyone at 0-0.
--
-- Duels come from pvp_matches (both seats, both directions). Cribbage comes
-- from completed tables, and only through the winner: at a 3-4 seat table
-- the winner beats every other seat, but two players who both lost have no
-- result against EACH OTHER, and recording one would break the mirror
-- invariant above (both sides would hold a loss). The runtime path in
-- lib/server/head-to-head-store.ts pairs them the same way.
-- ---------------------------------------------------------------------------

with duels as (
  select
    m.player0_id as profile_id,
    m.player1_id as opponent_id,
    m.game as game_id,
    case when m.winner_seat is null then 'draw' when m.winner_seat = 0 then 'win' else 'loss' end as outcome,
    m.settled_at as at,
    m.id as source_id
  from public.pvp_matches m
  where m.status = 'settled' and m.settled_at is not null
  union all
  select
    m.player1_id, m.player0_id, m.game,
    case when m.winner_seat is null then 'draw' when m.winner_seat = 1 then 'win' else 'loss' end,
    m.settled_at, m.id
  from public.pvp_matches m
  where m.status = 'settled' and m.settled_at is not null
),
cribbage as (
  select
    t.winner_id as profile_id,
    p.player_id as opponent_id,
    'cribbage'::text as game_id,
    'win'::text as outcome,
    coalesce(t.settled_at, t.started_at, t.created_at) as at,
    t.id as source_id
  from public.cribbage_tables t
  join public.cribbage_table_players p on p.table_id = t.id and p.player_id <> t.winner_id
  where t.status = 'completed' and t.winner_id is not null
  union all
  select
    p.player_id, t.winner_id, 'cribbage'::text, 'loss'::text,
    coalesce(t.settled_at, t.started_at, t.created_at), t.id
  from public.cribbage_tables t
  join public.cribbage_table_players p on p.table_id = t.id and p.player_id <> t.winner_id
  where t.status = 'completed' and t.winner_id is not null
),
history as (
  select * from duels
  union all
  select * from cribbage
),
-- Most recent first, so rn = 1 is the latest result and a streak is just how
-- far the same outcome runs from there.
ranked as (
  select
    h.*,
    row_number() over (
      partition by h.profile_id, h.opponent_id, h.game_id
      order by h.at desc, h.source_id desc
    ) as rn
  from history h
),
totals as (
  select
    profile_id, opponent_id, game_id,
    count(*) filter (where outcome = 'win')::integer as wins,
    count(*) filter (where outcome = 'loss')::integer as losses,
    count(*) filter (where outcome = 'draw')::integer as draws,
    count(*)::integer as played,
    max(at) as last_result_at
  from ranked
  group by profile_id, opponent_id, game_id
),
latest as (
  select profile_id, opponent_id, game_id, outcome
  from ranked
  where rn = 1
),
-- The first result that breaks the latest one's run; its rn minus one is the
-- streak length. No break at all means every result matches, so the streak
-- is the whole history.
breaks as (
  select r.profile_id, r.opponent_id, r.game_id, min(r.rn) as break_rn
  from ranked r
  join latest l
    on l.profile_id = r.profile_id and l.opponent_id = r.opponent_id and l.game_id = r.game_id
  where r.outcome <> l.outcome
  group by r.profile_id, r.opponent_id, r.game_id
),
-- Classic gaps-and-islands for the best win streak ever held: consecutive
-- wins share one (rn - row_number()) value, so each island is one run.
islands as (
  select
    profile_id, opponent_id, game_id, outcome,
    rn - row_number() over (
      partition by profile_id, opponent_id, game_id, outcome order by rn
    ) as island
  from ranked
),
best as (
  select profile_id, opponent_id, game_id, max(run_length)::integer as best_streak
  from (
    select profile_id, opponent_id, game_id, island, count(*) as run_length
    from islands
    where outcome = 'win'
    group by profile_id, opponent_id, game_id, island
  ) runs
  group by profile_id, opponent_id, game_id
)
insert into public.head_to_head_records (
  profile_id, opponent_id, game_id, wins, losses, draws,
  current_streak, best_streak, last_result_at
)
select
  t.profile_id, t.opponent_id, t.game_id, t.wins, t.losses, t.draws,
  case l.outcome
    when 'draw' then 0
    when 'win' then coalesce(b.break_rn - 1, t.played)
    else -coalesce(b.break_rn - 1, t.played)
  end,
  coalesce(s.best_streak, 0),
  t.last_result_at
from totals t
join latest l
  on l.profile_id = t.profile_id and l.opponent_id = t.opponent_id and l.game_id = t.game_id
left join breaks b
  on b.profile_id = t.profile_id and b.opponent_id = t.opponent_id and b.game_id = t.game_id
left join best s
  on s.profile_id = t.profile_id and s.opponent_id = t.opponent_id and s.game_id = t.game_id
on conflict (profile_id, opponent_id, game_id) do nothing;

-- ---------------------------------------------------------------------------
-- Access. Narrower than game_leaderboard_stats on purpose: a public
-- leaderboard standing is public by nature, but "how X does against Y" is
-- a fact about two specific people, and the friends board only ever shows
-- you your own side. No anon/authenticated grant at all -- reads go through
-- the service-role client in app/api/leaderboard.
-- ---------------------------------------------------------------------------

alter table public.head_to_head_records enable row level security;
revoke all on public.head_to_head_records from public, anon, authenticated;
