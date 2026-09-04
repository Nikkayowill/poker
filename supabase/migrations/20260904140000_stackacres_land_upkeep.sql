-- StackAcres: Land Maintenance, and the other half of the allowance valve.
--
-- TWO THINGS SHIP HERE, and they arrive together because they are both
-- consequences of the same change: a harvest is now valued and paid in Gold in
-- one step, so the exchange window that used to stand between a crop and its
-- money is gone and the ceiling behind it moved onto the harvest itself.
--
--   1. `stackacres_upkeep` -- one row per player per UTC day holding the Land
--      Maintenance already collected, plus `record_stackacres_upkeep` to add
--      to it. Same shape as `homestead_exchanges` beside it, and for the same
--      reason: the number that has to be right lives IN the row being locked,
--      so the check and the write are one statement.
--
--   2. `release_homestead_exchange` -- hands back allowance a harvest reserved
--      and then did not use.
--
-- WHY A RELEASE EXISTS AT ALL. A harvest reserves against the day's ceiling
-- BEFORE it settles any unit, because a full day has to refuse while the crops
-- are still standing -- discovering it afterwards would consume a harvest and
-- pay nothing for it. The cost of that order is that a sweep which then loses
-- a race to a second tab has over-reserved, and without this it would quietly
-- burn a player's day.
--
-- WHAT DOES NOT CHANGE, and it is the whole safety argument: the ceiling
-- inside `reserve_homestead_exchange` is untouched -- still 15,000, still flat,
-- still per player per UTC day, still the database's own authority that a
-- deploy can tighten but never raise. Nothing here can raise it either: the
-- release only ever SUBTRACTS, and it is floored at zero, so the worst a bug
-- or a hostile caller could do with it is give a player back allowance they
-- had already used. That is a smaller failure than the one it prevents, and it
-- is bounded by the same daily constant.
--
-- LAND MAINTENANCE IS NOT A SECOND WALLET PATH. The fee is netted out of what
-- a harvest pays, clamped at that harvest's value, so it can only ever reduce
-- a credit and never produce a debit. This table records what was taken so a
-- day is not billed twice; it is not a balance and cannot go negative.

create table public.stackacres_upkeep (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  gold integer not null default 0 check (gold >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, day)
);

comment on table public.stackacres_upkeep is
  'Land Maintenance collected from each player per UTC day, netted out of that day''s harvests. One row per (profile, day). Not a balance: it only ever grows, and it records what was taken so a day cannot be billed twice. Service-role only.';

comment on column public.stackacres_upkeep.day is
  'UTC calendar day, matching homestead_exchanges, the daily Gold grant and the Ante Up daily gates. One midnight for the whole app.';

alter table public.stackacres_upkeep enable row level security;
revoke all on public.stackacres_upkeep from anon, authenticated;

-- Adds `p_gold` to today's collected maintenance and returns the new total.
--
-- NO CEILING AND NO REFUSAL, which is the difference between this and
-- `reserve_homestead_exchange`. That one exists to stop Gold leaving; upkeep
-- only ever reduces what leaves, so there is nothing here a player could gain
-- by racing it. Two concurrent harvests each paying what they saw as due is
-- the worst case, and the primary key serializes the totals so neither total
-- is lost.
--
-- No advisory lock needed, same reasoning `reserve_homestead_exchange` spells
-- out: the number being added to lives IN the row being written and the
-- conflict target is the primary key, so the second transaction blocks on the
-- index and then adds to the row as the winner left it. Reach for an advisory
-- lock when the check is a count over sibling rows, not when it is a field of
-- the row itself.
create or replace function public.record_stackacres_upkeep(
  p_profile_id uuid,
  p_day date,
  p_gold integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_gold integer;
begin
  -- A zero or negative charge is a caller bug, not a refusal: it would hand
  -- back a non-null total and so report a day as billed when nothing was.
  if p_gold is null or p_gold <= 0 then
    raise exception 'StackAcres upkeep amount must be positive, got %', p_gold
      using errcode = 'check_violation';
  end if;

  insert into public.stackacres_upkeep as u (profile_id, day, gold)
  values (p_profile_id, p_day, p_gold)
  on conflict (profile_id, day) do update
    set gold = u.gold + p_gold,
        updated_at = now()
  returning u.gold into next_gold;

  return next_gold;
end;
$$;

comment on function public.record_stackacres_upkeep(uuid, date, integer) is
  'Records Land Maintenance netted out of a StackAcres harvest, per player per UTC day. Returns the day''s new total. Only ever grows; it has no ceiling because upkeep reduces what the farm pays out rather than adding to it.';

-- Hands back allowance a harvest reserved and did not use.
--
-- CLAMPED AT ZERO rather than refusing. This is the opposite posture to
-- `reserve_homestead_exchange`, which raises on a non-positive amount so that a
-- no-op can never be mistaken for a successful reservation. A release has the
-- other failure mode to guard: it runs AFTER a harvest has already settled and
-- already been paid, so it must never throw on top of that. Greatest(0, ...)
-- means a release larger than the day's total simply empties it.
--
-- It can only SUBTRACT. There is deliberately no branch here that raises the
-- day's total, so this function cannot be used -- by a bug, a bad deploy or a
-- caller who reached it -- to widen the flat daily ceiling by a single Gold.
create or replace function public.release_homestead_exchange(
  p_profile_id uuid,
  p_day date,
  p_gold integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_gold integer;
begin
  if p_gold is null or p_gold <= 0 then
    return null;
  end if;

  update public.homestead_exchanges as e
    set gold = greatest(0, e.gold - p_gold),
        updated_at = now()
  where e.profile_id = p_profile_id
    and e.day = p_day
  returning e.gold into next_gold;

  -- No row: there was nothing reserved today to hand back. Not an error --
  -- the caller is best-effort and has already paid the player correctly.
  return next_gold;
end;
$$;

comment on function public.release_homestead_exchange(uuid, date, integer) is
  'Returns unused StackAcres daily allowance after a harvest settled fewer units than it reserved for. Only ever subtracts, floored at zero, so it can never widen the flat daily ceiling.';

-- `public` is load-bearing and not redundant: anon and authenticated inherit
-- Postgres's default PUBLIC execute grant, so revoking from the two roles alone
-- leaves both functions callable on /rest/v1/rpc. Both are SECURITY DEFINER and
-- take the profile id as a parameter rather than reading the caller's session,
-- so an anonymous caller reaching either could act on any player's day.
-- Omitting `public` has shipped as a silent no-op twice in this repo. Verify
-- with proacl afterwards rather than by re-reading this file; a correct one has
-- no bare `=X/postgres` entry, and get_advisors catches the SECURITY DEFINER
-- case.
revoke execute on function public.record_stackacres_upkeep(uuid, date, integer)
  from public, anon, authenticated;
revoke execute on function public.release_homestead_exchange(uuid, date, integer)
  from public, anon, authenticated;
