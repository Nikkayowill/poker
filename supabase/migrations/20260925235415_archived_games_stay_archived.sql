-- An archived poker table used to keep "playing" in its state blob, so a
-- leave-seat on it cashed the already-refunded stack out a second time and
-- persist_game_action wrote games.status back to 'playing'. The app now
-- archives the blob itself and reads games.status on load. This migration
-- closes the same hole at the database: once a table is archived, no write
-- through persist_game_action can land on it again.

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
set search_path = ''
as $$
declare
  v_new_version bigint := (p_state ->> 'version')::bigint;
  v_updated_at timestamptz := (p_state ->> 'updatedAt')::timestamptz;
  v_hand_number integer := (p_state ->> 'handNumber')::integer;
begin
  if v_new_version <> p_expected_version + 1 then
    raise exception 'Invalid state version transition' using errcode = '22023';
  end if;

  -- Same errcode as a lost version race, so callers already treat it as
  -- "the table changed" and the timed wrapper returns false.
  if exists (select 1 from public.games where id = p_game_id and status = 'archived') then
    raise exception 'Game is archived' using errcode = '40001';
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

revoke all on function public.persist_game_action(
  uuid, bigint, jsonb, public.action_type, integer, uuid
) from public, anon, authenticated;
grant execute on function public.persist_game_action(
  uuid, bigint, jsonb, public.action_type, integer, uuid
) to service_role;

-- Tables archived before this fix: mark the blob archived too, and bump the
-- version so any request still holding the old one loses its write.
update public.game_state_private as gsp
set state = jsonb_set(
      jsonb_set(gsp.state, '{status}', '"archived"'),
      '{version}',
      to_jsonb(gsp.version + 1)
    ),
    version = gsp.version + 1
from public.games as g
where g.id = gsp.game_id
  and g.status = 'archived'
  and gsp.state ->> 'status' is distinct from 'archived';
