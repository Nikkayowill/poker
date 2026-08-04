-- M15: personal hand history and replay.
--
-- One durable row per completed hand, plus one row per seat that was dealt
-- into it. Written once, from the server, immediately after the game write
-- that completed the hand won. Never updated afterwards: a hand that has
-- been played is a fact, and the live game aggregate that produced it is
-- overwritten by the very next deal.

create table public.hand_archives (
  game_id uuid not null,
  hand_number integer not null check (hand_number > 0),
  tier text not null,
  -- Final board. 0 cards when the hand ended preflop, otherwise 3/4/5.
  community jsonb not null default '[]'::jsonb,
  pot integer not null check (pot >= 0),
  rake integer not null default 0 check (rake >= 0),
  -- [{ seatId, name, amount, hand, bestFive }]. bestFive is null for an
  -- uncontested pot; see lib/game/types.ts's Winner.
  winners jsonb not null default '[]'::jsonb,
  -- Ordered action timeline, already truncated by the server to a bounded
  -- length. Replay is a summary, not an audit log.
  actions jsonb not null default '[]'::jsonb,
  -- Denormalized from the seat rows so a replay can decide what to show
  -- without reading every player row first.
  reached_showdown boolean not null default false,
  final_version integer not null check (final_version >= 0),
  ended_at timestamptz not null default now(),
  primary key (game_id, hand_number),
  -- The board can never be longer than a real one, whatever the caller sends.
  constraint hand_archives_community_length check (jsonb_array_length(community) between 0 and 5),
  constraint hand_archives_actions_length check (jsonb_array_length(actions) <= 200)
);

-- Deliberately no FK to public.games: history has to outlive table cleanup,
-- and a completed table being reaped must not take a player's hand history
-- with it.
comment on table public.hand_archives is
  'Immutable per-hand record for personal history/replay. No FK to games so history survives table cleanup. Browsers have no direct access.';
comment on column public.hand_archives.reached_showdown is
  'True only when 2+ players actually reached showdown -- the condition under which any opponent card may ever be replayed.';
comment on column public.hand_archives.actions is
  'Bounded, server-truncated timeline. Capped by hand_archives_actions_length so one pathological hand cannot bloat the table.';

-- Pruning/retention scans and the "recent hands" ordering both want this.
create index hand_archives_ended_at_idx on public.hand_archives(ended_at desc);

create table public.hand_archive_players (
  game_id uuid not null,
  hand_number integer not null,
  -- Engine seat id (a string), not a position: positions are reused between
  -- hands as players come and go, so only the seat id identifies the row.
  seat_id text not null,
  seat_position smallint not null check (seat_position between 0 and 5),
  profile_id uuid references public.profiles(id) on delete set null,
  -- Snapshot, not a join. The name shown in a replay is the name that was at
  -- the table that night, and it must survive both a rename and a deletion.
  display_name text not null,
  is_human boolean not null default true,
  hole_cards jsonb not null default '[]'::jsonb,
  -- Whether the table saw these cards. The single gate on ever replaying
  -- them to anyone but their owner; computed once, at archive time, from the
  -- completed state -- see lib/game/engine.ts's seatCardsWereShown.
  cards_were_shown boolean not null default false,
  committed integer not null default 0 check (committed >= 0),
  amount_won integer not null default 0 check (amount_won >= 0),
  net_profit integer not null default 0,
  -- Denormalized from the parent archive, and written in the same statement
  -- from the same value. "My recent hands, newest first" is the only list
  -- this table serves, and carrying the sort key here keeps that a
  -- single-table index scan with a self-contained pagination cursor.
  ended_at timestamptz not null,
  primary key (game_id, hand_number, seat_id),
  constraint hand_archive_players_hole_cards_length check (jsonb_array_length(hole_cards) between 0 and 2),
  foreign key (game_id, hand_number)
    references public.hand_archives(game_id, hand_number) on delete cascade
);

comment on table public.hand_archive_players is
  'Per-seat outcome for an archived hand. Browsers have no direct access; the server redacts hole cards per caller.';
comment on column public.hand_archive_players.profile_id is
  'Owning profile while it exists. Set null on account deletion so the rest of the hand stays replayable for everyone else who was in it.';
comment on column public.hand_archive_players.cards_were_shown is
  'Table-wide visibility at the time the hand ended. False means these cards were mucked and may only ever be returned to their own owner.';

-- "My recent hands", newest first, is the only list query this table serves.
-- Indexed on the FK so an account deletion's cascade-to-null is not a scan.
create index hand_archive_players_profile_idx
  on public.hand_archive_players(profile_id, ended_at desc, game_id, hand_number)
  where profile_id is not null;

create index hand_archive_players_hand_idx
  on public.hand_archive_players(game_id, hand_number);

alter table public.hand_archives enable row level security;
alter table public.hand_archive_players enable row level security;

-- No policies and no grants to anon/authenticated: both tables are reachable
-- only through the service-role server stores, which redact per caller. RLS
-- is enabled so a future grant cannot accidentally expose whole rows --
-- including other players' hole cards.
revoke all on public.hand_archives from anon, authenticated;
revoke all on public.hand_archive_players from anon, authenticated;

/**
 * Writes one completed hand and all of its seats in a single transaction.
 *
 * ON CONFLICT DO NOTHING on both inserts: the two hand-completion paths can
 * race on the same hand, and a retry of a call that already succeeded must
 * be a no-op rather than a duplicate or an error. Returns true only when
 * this call is the one that actually inserted the archive.
 */
create or replace function public.archive_hand(
  p_game_id uuid,
  p_hand_number integer,
  p_tier text,
  p_community jsonb,
  p_pot integer,
  p_rake integer,
  p_winners jsonb,
  p_actions jsonb,
  p_reached_showdown boolean,
  p_final_version integer,
  p_players jsonb
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  -- row_count is an integer and there is no integer->boolean cast, so this
  -- has to be counted before it can be answered as a yes/no.
  v_inserted_rows integer := 0;
  -- One timestamp for the archive and every seat row in it, so the
  -- denormalized copy can never disagree with its parent.
  v_ended_at timestamptz := now();
begin
  insert into public.hand_archives (
    game_id, hand_number, tier, community, pot, rake,
    winners, actions, reached_showdown, final_version, ended_at
  )
  values (
    p_game_id, p_hand_number, p_tier, coalesce(p_community, '[]'::jsonb),
    p_pot, coalesce(p_rake, 0), coalesce(p_winners, '[]'::jsonb),
    coalesce(p_actions, '[]'::jsonb), coalesce(p_reached_showdown, false),
    p_final_version, v_ended_at
  )
  on conflict (game_id, hand_number) do nothing;

  get diagnostics v_inserted_rows = row_count;

  -- Only the winning inserter writes the seats. A loser returning here would
  -- at best re-do identical work and at worst race the cascade.
  if v_inserted_rows = 0 then
    return false;
  end if;

  insert into public.hand_archive_players (
    game_id, hand_number, seat_id, seat_position, profile_id, display_name,
    is_human, hole_cards, cards_were_shown, committed, amount_won, net_profit,
    ended_at
  )
  select
    p_game_id,
    p_hand_number,
    player.seat_id,
    player.seat_position,
    player.profile_id,
    player.display_name,
    coalesce(player.is_human, true),
    coalesce(player.hole_cards, '[]'::jsonb),
    coalesce(player.cards_were_shown, false),
    coalesce(player.committed, 0),
    coalesce(player.amount_won, 0),
    coalesce(player.net_profit, 0),
    v_ended_at
  from jsonb_to_recordset(coalesce(p_players, '[]'::jsonb)) as player(
    seat_id text,
    seat_position smallint,
    profile_id uuid,
    display_name text,
    is_human boolean,
    hole_cards jsonb,
    cards_were_shown boolean,
    committed integer,
    amount_won integer,
    net_profit integer
  )
  on conflict (game_id, hand_number, seat_id) do nothing;

  return true;
end;
$$;

revoke all on function public.archive_hand(
  uuid, integer, text, jsonb, integer, integer, jsonb, jsonb, boolean, integer, jsonb
) from anon, authenticated;
