-- The watering can.
--
-- Watering a dry crop by hand now spends one unit of water, and tapping the
-- well fills the can back up (lib/stackacres/water-can.ts). A player with no
-- row has a full can, so nobody starts out empty and existing players need
-- no backfill. Pipes off a well still water for free and never touch this.
--
-- Same shape as homestead_feed: one row per player, service-role only, and a
-- CHECK that makes an overdraw fail loudly (23514) instead of going negative.
-- There is deliberately no CHECK on the upper bound, so the capacity can be
-- retuned without stranding rows. The functions clamp to the capacity the
-- service passes in.

create table public.homestead_water (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  level integer not null check (level >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.homestead_water is
  'Water left in a player''s watering can. No row means a full can. Service-role only.';

alter table public.homestead_water enable row level security;
revoke all on public.homestead_water from anon, authenticated;

-- Moves the level by p_delta, clamped to p_capacity. A first write starts
-- from a full can. Raises 23514 from the level check rather than going
-- negative; the store treats that as an empty can.
create or replace function public.adjust_homestead_water(
  p_profile_id uuid,
  p_delta integer,
  p_capacity integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_level integer;
begin
  insert into public.homestead_water as w (profile_id, level)
  values (p_profile_id, least(p_capacity, p_capacity + p_delta))
  on conflict (profile_id) do update
    set level = least(p_capacity, w.level + p_delta),
        updated_at = now()
  returning w.level into next_level;

  return next_level;
end;
$$;

comment on function public.adjust_homestead_water(uuid, integer, integer) is
  'Moves a player''s watering can level atomically, clamped to the capacity passed in. Raises 23514 rather than going negative.';

-- Fills the can to p_capacity. What tapping the well does.
create or replace function public.fill_homestead_water(
  p_profile_id uuid,
  p_capacity integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.homestead_water as w (profile_id, level)
  values (p_profile_id, p_capacity)
  on conflict (profile_id) do update
    set level = p_capacity,
        updated_at = now();

  return p_capacity;
end;
$$;

comment on function public.fill_homestead_water(uuid, integer) is
  'Fills a player''s watering can to the capacity passed in.';

-- `public` has to be named: anon and authenticated inherit the default PUBLIC
-- execute grant, so revoking from just those two leaves the functions
-- callable over /rest/v1/rpc.
revoke all on function public.adjust_homestead_water(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.fill_homestead_water(uuid, integer) from public, anon, authenticated;
