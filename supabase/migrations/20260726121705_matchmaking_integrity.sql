-- Matchmaking integrity and safe upgrade path for tables created before
-- multiplayer seating was introduced.

-- game_seats is a queryable projection of the authoritative private aggregate.
-- Backfill newly-added control fields before enforcing their invariants. The
-- owner fallback preserves the original host for aggregates written before
-- Seat.ownerToken existed.
update public.game_seats as gs
set owner_token = coalesce(
      nullif(seat.value ->> 'ownerToken', '')::uuid,
      case when gs.is_bot = false then g.owner_token else null end
    ),
    personality = nullif(seat.value ->> 'personality', ''),
    is_bot = case
      when seat.value ? 'isHuman' then not (seat.value ->> 'isHuman')::boolean
      else gs.is_bot
    end,
    updated_at = now()
from public.games as g
join public.game_state_private as private_state
  on private_state.game_id = g.id
cross join lateral jsonb_array_elements(private_state.state -> 'seats') as seat(value)
where gs.game_id = g.id
  and gs.id = nullif(seat.value ->> 'id', '')::uuid;

-- A session may own at most one seat at a given table. This also provides a
-- database-level guard if two quick-play requests for the same session race.
create unique index game_seats_one_owner_per_game_uidx
  on public.game_seats(game_id, owner_token)
  where owner_token is not null;

-- Seat control changes are persisted in one UPDATE, so these values should
-- never disagree: open seats are bots and claimed seats are human-controlled.
alter table public.game_seats
  add constraint game_seats_control_mode_check
  check (
    (owner_token is null and is_bot = true)
    or (owner_token is not null and is_bot = false)
  );

-- Avoid ON DELETE SET NULL creating an invalid half-human/half-open seat.
-- Session cleanup must release a seat through the game engine first.
alter table public.game_seats
  drop constraint game_seats_owner_token_fkey,
  add constraint game_seats_owner_token_fkey
    foreign key (owner_token)
    references public.player_sessions(token)
    on delete restrict;

-- Public rooms never have shareable codes, and private rooms always do.
alter table public.games
  add constraint games_privacy_room_code_check
  check (
    (is_private = true and room_code is not null)
    or (is_private = false and room_code is null)
  );

-- persist_game_action produces exactly one ledger row per committed aggregate
-- version. Enforce that contract so retries cannot duplicate audit history.
create unique index game_actions_one_row_per_version_uidx
  on public.game_actions(game_id, state_version);

-- The function already schema-qualifies every application relation. An empty
-- search path is the safest setting for a SECURITY DEFINER function.
alter function public.persist_game_action(
  uuid, bigint, jsonb, public.action_type, integer, uuid
) set search_path = '';

revoke all on function public.persist_game_action(
  uuid, bigint, jsonb, public.action_type, integer, uuid
) from public, anon, authenticated;
grant execute on function public.persist_game_action(
  uuid, bigint, jsonb, public.action_type, integer, uuid
) to service_role;

comment on index public.game_seats_one_owner_per_game_uidx is
  'Prevents one session from claiming multiple seats at the same table under concurrent quick-play requests.';
comment on constraint games_privacy_room_code_check on public.games is
  'Private games require a room code; public matchmaking games must not expose one.';
