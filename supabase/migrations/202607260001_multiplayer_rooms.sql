-- Quick-play matchmaking, private room codes, and multi-human seating.
-- A table can now hold more than one real player: any seat with a null
-- owner_token is bot-controlled and open for another human to claim.

alter table public.games
  add column is_private boolean not null default false,
  add column room_code text
    check (room_code is null or room_code ~ '^[A-Z0-9]{6}$');

-- A plain UNIQUE constraint treats NULLs as distinct, so any number of
-- public games (room_code is null) coexist alongside unique private codes.
alter table public.games
  add constraint games_room_code_key unique (room_code);

alter table public.game_seats
  add column owner_token uuid references public.player_sessions(token) on delete set null,
  add column personality text
    check (personality is null or personality in ('MANIAC', 'ROCK', 'CALLING_STATION'));

-- Quick-play matchmaking: "find a public, still-playable table with an open seat."
create index games_public_open_idx
  on public.games(created_at)
  where is_private = false and status = 'playing';

create index game_seats_open_bot_idx
  on public.game_seats(game_id)
  where owner_token is null and is_bot = true;

create index game_seats_owner_token_idx
  on public.game_seats(owner_token)
  where owner_token is not null;

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

  -- Also syncs seat identity (owner_token, is_bot, display_name, avatar
  -- fields) so a mid-game seat claim (a bot seat becoming human-controlled)
  -- persists through this same generic per-action update.
  update public.game_seats as gs
  set stack = (seat.value ->> 'stack')::integer,
      status = (seat.value ->> 'status')::public.seat_status,
      owner_token = (seat.value ->> 'ownerToken')::uuid,
      is_bot = not (seat.value ->> 'isHuman')::boolean,
      personality = seat.value ->> 'personality',
      display_name = seat.value ->> 'name',
      initials = seat.value ->> 'initials',
      avatar_preset = (seat.value ->> 'avatarPreset')::public.avatar_preset,
      avatar_url = seat.value ->> 'avatarUrl',
      accent = seat.value ->> 'accent',
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

comment on column public.games.is_private is
  'Private tables are only reachable via room_code; quick play only matches is_private = false.';
comment on column public.games.room_code is
  'Shareable 6-character join code for private tables; null for public tables.';
comment on column public.game_seats.owner_token is
  'Session token of the human seated here; null means the seat is bot-controlled and open to be claimed.';
comment on column public.game_seats.personality is
  'AI decision-making style for a bot-controlled seat; null once a human claims the seat.';
