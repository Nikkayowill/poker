-- River Room: server-authoritative no-limit Hold'em persistence.
-- Run with `supabase db push` or paste into the Supabase SQL editor.

create extension if not exists pgcrypto;

create type public.game_status as enum ('waiting', 'playing', 'complete', 'archived');
create type public.seat_status as enum ('active', 'folded', 'all-in', 'out');
create type public.action_type as enum (
  'fold', 'check', 'call', 'raise', 'all_in', 'next_hand',
  'small_blind', 'big_blind', 'deal', 'showdown', 'payout'
);

create table public.player_sessions (
  token uuid primary key,
  display_name varchar(18) not null check (char_length(trim(display_name)) between 1 and 18),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  owner_token uuid not null references public.player_sessions(token) on delete restrict,
  status public.game_status not null default 'waiting',
  small_blind integer not null check (small_blind > 0),
  big_blind integer not null check (big_blind > small_blind),
  current_hand_number integer not null default 1 check (current_hand_number > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.game_seats (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  seat_number smallint not null check (seat_number between 0 and 8),
  display_name varchar(18) not null,
  is_bot boolean not null default false,
  stack integer not null check (stack >= 0),
  status public.seat_status not null default 'active',
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, seat_number)
);

-- The complete aggregate contains the shuffled deck and every hole card.
-- It deliberately has no client SELECT policy and is only read by the service role.
create table public.game_state_private (
  game_id uuid primary key references public.games(id) on delete cascade,
  version bigint not null default 1 check (version > 0),
  state jsonb not null,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(state) = 'object')
);

create table public.game_actions (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  hand_number integer not null check (hand_number > 0),
  actor_seat_id uuid references public.game_seats(id) on delete set null,
  action_type public.action_type not null,
  amount integer check (amount is null or amount >= 0),
  state_version bigint not null check (state_version > 0),
  created_at timestamptz not null default now()
);

-- Realtime publishes only this safe invalidation signal, never private game state.
-- Browsers react to the version change and fetch their filtered view from the API.
create table public.game_signals (
  game_id uuid primary key references public.games(id) on delete cascade,
  version bigint not null check (version > 0),
  updated_at timestamptz not null default now()
);

create index game_seats_game_id_idx on public.game_seats(game_id);
create index game_actions_game_hand_idx on public.game_actions(game_id, hand_number, id);
create index games_updated_at_idx on public.games(updated_at desc);

alter table public.player_sessions enable row level security;
alter table public.games enable row level security;
alter table public.game_seats enable row level security;
alter table public.game_state_private enable row level security;
alter table public.game_actions enable row level security;
alter table public.game_signals enable row level security;

-- UUID table IDs carry 122 bits of entropy. Signals contain no cards, names, or chips.
create policy "anonymous clients can receive safe table invalidations"
  on public.game_signals for select
  to anon, authenticated
  using (true);

-- No client insert/update/delete policies exist. All mutations pass through the
-- Next.js server, which validates the action and uses the service role.

create or replace function public.persist_game_action(
  p_game_id uuid,
  p_expected_version bigint,
  p_state jsonb,
  p_action_type public.action_type,
  p_amount integer,
  p_actor_seat_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_version bigint := (p_state ->> 'version')::bigint;
  v_updated_at timestamptz := (p_state ->> 'updatedAt')::timestamptz;
  v_hand_number integer := (p_state ->> 'handNumber')::integer;
begin
  if v_new_version <> p_expected_version + 1 then
    raise exception 'Invalid state version transition' using errcode = '22023';
  end if;

  update public.game_state_private
  set state = p_state, version = v_new_version, updated_at = v_updated_at
  where game_id = p_game_id and version = p_expected_version;

  if not found then
    raise exception 'Concurrent game update' using errcode = '40001';
  end if;

  update public.games
  set status = (p_state ->> 'status')::public.game_status,
      current_hand_number = v_hand_number,
      updated_at = v_updated_at,
      completed_at = case
        when (p_state ->> 'status') = 'complete' then v_updated_at
        else null
      end
  where id = p_game_id;

  update public.game_seats as gs
  set stack = (seat.value ->> 'stack')::integer,
      status = (seat.value ->> 'status')::public.seat_status,
      updated_at = v_updated_at
  from jsonb_array_elements(p_state -> 'seats') as seat(value)
  where gs.game_id = p_game_id
    and gs.id = (seat.value ->> 'id')::uuid;

  insert into public.game_actions (
    game_id, hand_number, actor_seat_id, action_type, amount, state_version
  ) values (
    p_game_id, v_hand_number, p_actor_seat_id, p_action_type, p_amount, v_new_version
  );

  insert into public.game_signals (game_id, version, updated_at)
  values (p_game_id, v_new_version, v_updated_at)
  on conflict (game_id) do update
  set version = excluded.version, updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.persist_game_action(
  uuid, bigint, jsonb, public.action_type, integer, uuid
) from public, anon, authenticated;
grant execute on function public.persist_game_action(
  uuid, bigint, jsonb, public.action_type, integer, uuid
) to service_role;

alter publication supabase_realtime add table public.game_signals;

comment on table public.game_state_private is
  'Service-role-only aggregate: authoritative deck, private cards, turn and betting state.';
comment on table public.game_actions is
  'Append-only action ledger for observability, replay analysis and dispute auditing.';
comment on table public.game_signals is
  'Non-sensitive realtime invalidation channel. Contains no playable game information.';
