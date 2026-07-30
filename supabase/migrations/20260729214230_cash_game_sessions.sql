-- One durable row per human cash-game buy-in. Live stacks remain in the
-- authoritative game worker; this table is touched only at buy-in, cash-out,
-- or an explicit debounced checkpoint.

create table public.cash_game_sessions (
  id uuid primary key,
  game_id uuid not null,
  profile_id uuid references public.profiles(id) on delete set null,
  session_token uuid references public.player_sessions(token) on delete set null,
  seat_number smallint not null check (seat_number between 1 and 6),
  session_start_chips integer not null check (session_start_chips > 0),
  current_chips integer not null check (current_chips >= 0),
  hands_won_count integer not null default 0 check (hands_won_count >= 0),
  multiplier_basis_points integer not null default 10000
    check (multiplier_basis_points in (10000, 11000, 12500, 15000)),
  net_earnings integer not null default 0,
  payout_chips integer,
  credited_gold integer,
  status text not null default 'active'
    check (status in ('active', 'settled', 'refunded')),
  opened_at timestamptz not null default now(),
  last_checkpoint_at timestamptz,
  settled_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    (status = 'active' and payout_chips is null and credited_gold is null and settled_at is null)
    or
    (status in ('settled', 'refunded') and payout_chips is not null
      and credited_gold is not null and settled_at is not null)
  )
);

create unique index cash_game_sessions_one_active_profile_idx
  on public.cash_game_sessions(profile_id)
  where status = 'active';

create unique index cash_game_sessions_one_active_seat_idx
  on public.cash_game_sessions(game_id, seat_number)
  where status = 'active';

create index cash_game_sessions_game_status_idx
  on public.cash_game_sessions(game_id, status);

create index cash_game_sessions_profile_opened_idx
  on public.cash_game_sessions(profile_id, opened_at desc);

alter table public.cash_game_sessions enable row level security;

comment on table public.cash_game_sessions is
  'Private cash-game accounting ledger. Browsers have no direct access.';
comment on column public.cash_game_sessions.game_id is
  'Application-generated game UUID. No FK so an atomic buy-in can precede initial game persistence.';
comment on column public.cash_game_sessions.profile_id is
  'Owning profile while it exists. Set null on account deletion so the accounting ledger is retained.';
comment on column public.cash_game_sessions.session_token is
  'Server session used to authorize an active cash-out. Set null when that session is permanently deleted.';
comment on column public.cash_game_sessions.multiplier_basis_points is
  '10000=1x, 11000=1.1x, 12500=1.25x, 15000=1.5x.';

create or replace function public.open_cash_game_session(
  p_session_id uuid,
  p_game_id uuid,
  p_token uuid,
  p_seat_number smallint,
  p_buy_in integer
) returns table (
  cash_session_id uuid,
  profile_id uuid,
  gold_balance integer,
  unlimited_gold boolean,
  created_now boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_existing public.cash_game_sessions%rowtype;
begin
  if p_session_id is null or p_game_id is null or p_token is null then
    raise exception 'Missing cash-game session identifier' using errcode = '22023';
  end if;
  if p_seat_number is null or p_seat_number < 1 or p_seat_number > 6 then
    raise exception 'Seat number must be from 1 through 6' using errcode = '22023';
  end if;
  if p_buy_in is null or p_buy_in <= 0 then
    raise exception 'Buy-in must be positive' using errcode = '22023';
  end if;

  select p.* into v_profile
  from public.profiles as p
  where p.session_token = p_token
  for update;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  select s.* into v_existing
  from public.cash_game_sessions as s
  where s.id = p_session_id;

  if found then
    if v_existing.game_id <> p_game_id
      or v_existing.profile_id <> v_profile.id
      or v_existing.session_token <> p_token
      or v_existing.seat_number <> p_seat_number
      or v_existing.session_start_chips <> p_buy_in then
      raise exception 'Cash-game session idempotency conflict' using errcode = '22023';
    end if;

    return query select
      v_existing.id,
      v_profile.id,
      v_profile.gold_balance,
      v_profile.unlimited_gold,
      false;
    return;
  end if;

  if not v_profile.unlimited_gold and v_profile.gold_balance < p_buy_in then
    raise exception 'Not enough Gold' using errcode = 'P0001';
  end if;

  if not v_profile.unlimited_gold then
    update public.profiles
    set gold_balance = gold_balance - p_buy_in,
        updated_at = now()
    where id = v_profile.id
    returning * into v_profile;
  end if;

  insert into public.cash_game_sessions (
    id,
    game_id,
    profile_id,
    session_token,
    seat_number,
    session_start_chips,
    current_chips
  ) values (
    p_session_id,
    p_game_id,
    v_profile.id,
    p_token,
    p_seat_number,
    p_buy_in,
    p_buy_in
  );

  return query select
    p_session_id,
    v_profile.id,
    v_profile.gold_balance,
    v_profile.unlimited_gold,
    true;
end;
$$;

create or replace function public.settle_cash_game_session(
  p_session_id uuid,
  p_token uuid,
  p_current_chips integer,
  p_hands_won_count integer
) returns table (
  cash_session_id uuid,
  current_chips integer,
  hands_won_count integer,
  net_earnings integer,
  multiplier_basis_points integer,
  payout_chips integer,
  credited_gold integer,
  gold_balance integer,
  settled_now boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session public.cash_game_sessions%rowtype;
  v_profile public.profiles%rowtype;
  v_net integer;
  v_multiplier integer;
  v_payout integer;
  v_credit integer;
begin
  if p_current_chips is null or p_current_chips < 0 then
    raise exception 'Current chips cannot be negative' using errcode = '22023';
  end if;
  if p_hands_won_count is null or p_hands_won_count < 0 then
    raise exception 'Hands won cannot be negative' using errcode = '22023';
  end if;

  select s.* into v_session
  from public.cash_game_sessions as s
  where s.id = p_session_id and s.session_token = p_token
  for update;

  if not found then
    raise exception 'Cash-game session not found' using errcode = 'P0002';
  end if;

  select p.* into v_profile
  from public.profiles as p
  where p.id = v_session.profile_id
  for update;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if v_session.status <> 'active' then
    return query select
      v_session.id,
      v_session.current_chips,
      v_session.hands_won_count,
      v_session.net_earnings,
      v_session.multiplier_basis_points,
      v_session.payout_chips,
      v_session.credited_gold,
      v_profile.gold_balance,
      false;
    return;
  end if;

  v_net := p_current_chips - v_session.session_start_chips;
  v_multiplier := case
    when v_net <= 0 then 10000
    when p_hands_won_count >= 20 then 15000
    when p_hands_won_count >= 10 then 12500
    when p_hands_won_count >= 5 then 11000
    else 10000
  end;
  v_payout := case
    when v_net > 0
      then v_session.session_start_chips
        + floor((v_net::numeric * v_multiplier::numeric) / 10000)::integer
    else p_current_chips
  end;
  v_credit := case when v_profile.unlimited_gold then 0 else v_payout end;

  if v_credit > 0 then
    update public.profiles
    set gold_balance = gold_balance + v_credit,
        updated_at = now()
    where id = v_profile.id
    returning * into v_profile;
  end if;

  update public.cash_game_sessions
  set current_chips = p_current_chips,
      hands_won_count = p_hands_won_count,
      multiplier_basis_points = v_multiplier,
      net_earnings = v_net,
      payout_chips = v_payout,
      credited_gold = v_credit,
      status = 'settled',
      settled_at = now(),
      updated_at = now()
  where id = v_session.id
  returning * into v_session;

  return query select
    v_session.id,
    v_session.current_chips,
    v_session.hands_won_count,
    v_session.net_earnings,
    v_session.multiplier_basis_points,
    v_session.payout_chips,
    v_session.credited_gold,
    v_profile.gold_balance,
    true;
end;
$$;

create or replace function public.refund_cash_game_session(
  p_session_id uuid,
  p_token uuid
) returns table (
  cash_session_id uuid,
  credited_gold integer,
  gold_balance integer,
  refunded_now boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session public.cash_game_sessions%rowtype;
  v_profile public.profiles%rowtype;
  v_credit integer;
begin
  select s.* into v_session
  from public.cash_game_sessions as s
  where s.id = p_session_id and s.session_token = p_token
  for update;

  if not found then
    raise exception 'Cash-game session not found' using errcode = 'P0002';
  end if;

  select p.* into v_profile
  from public.profiles as p
  where p.id = v_session.profile_id
  for update;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if v_session.status <> 'active' then
    return query select
      v_session.id,
      v_session.credited_gold,
      v_profile.gold_balance,
      false;
    return;
  end if;

  v_credit := case
    when v_profile.unlimited_gold then 0
    else v_session.session_start_chips
  end;

  if v_credit > 0 then
    update public.profiles
    set gold_balance = gold_balance + v_credit,
        updated_at = now()
    where id = v_profile.id
    returning * into v_profile;
  end if;

  update public.cash_game_sessions
  set current_chips = session_start_chips,
      hands_won_count = 0,
      multiplier_basis_points = 10000,
      net_earnings = 0,
      payout_chips = session_start_chips,
      credited_gold = v_credit,
      status = 'refunded',
      settled_at = now(),
      updated_at = now()
  where id = v_session.id
  returning * into v_session;

  return query select
    v_session.id,
    v_session.credited_gold,
    v_profile.gold_balance,
    true;
end;
$$;

-- A persistent TableManager is the sole writer for a live room. It may
-- advance several in-memory versions during one debounce window, so this
-- checkpoint accepts any strictly increasing version while still guarding
-- against a second/stale manager with optimistic concurrency.
create or replace function public.checkpoint_game_state(
  p_game_id uuid,
  p_expected_version bigint,
  p_state jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_new_version bigint;
  v_updated_at timestamptz;
  v_hand_number integer;
begin
  if p_game_id is null
    or p_expected_version is null
    or p_state is null
    or jsonb_typeof(p_state) <> 'object'
    or nullif(p_state ->> 'version', '') is null
    or nullif(p_state ->> 'updatedAt', '') is null
    or nullif(p_state ->> 'handNumber', '') is null then
    raise exception 'Malformed game checkpoint: game id, expected version, version, updatedAt, and handNumber are required'
      using errcode = '22023';
  end if;

  begin
    v_new_version := (p_state ->> 'version')::bigint;
    v_updated_at := (p_state ->> 'updatedAt')::timestamptz;
    v_hand_number := (p_state ->> 'handNumber')::integer;
  exception when others then
    raise exception 'Malformed game checkpoint: version, updatedAt, or handNumber has an invalid type or value'
      using errcode = '22023';
  end;

  if v_new_version <= 0
    or v_hand_number <= 0
    or not isfinite(v_updated_at) then
    raise exception 'Malformed game checkpoint: version and handNumber must be positive and updatedAt must be finite'
      using errcode = '22023';
  end if;

  if v_new_version <= p_expected_version then
    raise exception 'Checkpoint version must increase' using errcode = '22023';
  end if;

  update public.game_state_private
  set state = p_state,
      version = v_new_version,
      updated_at = v_updated_at
  where game_id = p_game_id and version = p_expected_version;

  if not found then
    raise exception 'Concurrent game checkpoint' using errcode = '40001';
  end if;

  update public.games
  set status = (p_state ->> 'status')::public.game_status,
      current_hand_number = v_hand_number,
      updated_at = v_updated_at,
      completed_at = case
        when (p_state ->> 'status') = 'complete' then v_updated_at
        else completed_at
      end
  where id = p_game_id;

  update public.game_seats as gs
  set stack = (seat.value ->> 'stack')::integer,
      status = (seat.value ->> 'status')::public.seat_status,
      display_name = seat.value ->> 'name',
      owner_token = nullif(seat.value ->> 'ownerToken', '')::uuid,
      is_bot = not (seat.value ->> 'isHuman')::boolean,
      profile_id = case
        when (seat.value ->> 'isHuman')::boolean
          then (
            select p.id
            from public.profiles as p
            where p.session_token = nullif(seat.value ->> 'ownerToken', '')::uuid
          )
        else null
      end,
      personality = nullif(seat.value ->> 'personality', ''),
      initials = seat.value ->> 'initials',
      avatar_preset = (seat.value ->> 'avatarPreset')::public.avatar_preset,
      avatar_url = seat.value ->> 'avatarUrl',
      accent = seat.value ->> 'accent',
      updated_at = v_updated_at
  from jsonb_array_elements(p_state -> 'seats') as seat(value)
  where gs.game_id = p_game_id
    and gs.id = (seat.value ->> 'id')::uuid;

  insert into public.game_signals (game_id, version, updated_at)
  values (p_game_id, v_new_version, v_updated_at)
  on conflict (game_id) do update
  set version = excluded.version,
      updated_at = excluded.updated_at;
end;
$$;

revoke all on table public.cash_game_sessions from public, anon, authenticated;
grant select, insert, update on table public.cash_game_sessions to service_role;

revoke all on function public.open_cash_game_session(uuid, uuid, uuid, smallint, integer)
  from public, anon, authenticated;
grant execute on function public.open_cash_game_session(uuid, uuid, uuid, smallint, integer)
  to service_role;

revoke all on function public.settle_cash_game_session(uuid, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.settle_cash_game_session(uuid, uuid, integer, integer)
  to service_role;

revoke all on function public.refund_cash_game_session(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.refund_cash_game_session(uuid, uuid)
  to service_role;

revoke all on function public.checkpoint_game_state(uuid, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.checkpoint_game_state(uuid, bigint, jsonb)
  to service_role;
