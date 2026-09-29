-- StackAcres gets land again: three of the four districts start wild, and
-- keeping the ones you clear costs a compounding daily fee.
--
-- WHY LAND CAME BACK. 20260903180000 deleted the sixteen-tile plot ladder
-- outright, and with it the only thing a player ever BOUGHT that was not a
-- crop, an animal or a slot to keep one in. That left the map with four
-- districts that were all simply there from the first minute, three of them
-- full of pens the player could not afford yet -- so the whole east half of
-- the world read as content that had failed to load rather than as somewhere
-- to get to. This puts the ground itself back on the ladder, at district
-- scale rather than tile scale.
--
-- Two tables, both keyed on a profile, both service-role only, and neither of
-- them holding a scrap of Gold: the Gold price of clearing land is a constant
-- in lib/stackacres/sectors.ts and is spent through spendGoldByProfile like
-- every other sink, and the maintenance fee is denominated in BUSHELS, which
-- never leave the farm. Nothing here is a new Gold faucet -- see the
-- asymmetry note at the top of lib/server/stackacres-service.ts.
--
-- Tables are still named homestead_* on purpose. The app renamed Homestead to
-- StackAcres in 20260902; the database deliberately did not follow, for the
-- same reason river_* cookies keep their name.

-- Cleared land. One row per (player, district), written once and never
-- updated -- clearing is permanent and is not refunded, so there is no state
-- machine here and no version column to guard: the primary key IS the
-- idempotency guard, and two tabs clearing the same ground pay for it once
-- because only one of them can insert the row.
create table public.homestead_sectors (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- The same four ids ZONE_IDS holds. `wallow` is the internal id of the
  -- district labelled "The Fold" (see lib/stackacres/zones.ts) -- a data
  -- migration to fix a caption was not worth doing then and is not now.
  sector text not null check (sector in ('farmstead', 'meadow', 'oxfields', 'wallow')),
  cleared_at timestamptz not null default now(),
  primary key (profile_id, sector)
);

comment on table public.homestead_sectors is
  'Districts a player has paid Gold to clear. Permanent and never refunded. NOT the whole answer to what a player may work: lib/stackacres/sectors.ts''s unlockedSectors also counts any district they already keep stock in, which is what carries farms that predate this feature with no backfill. Service-role only.';

alter table public.homestead_sectors enable row level security;
revoke all on public.homestead_sectors from anon, authenticated;

-- Deliberately NO row for the Farmstead is ever written, and no constraint
-- stopping one. Home is unlocked in code (`HOME_SECTOR`), because a player
-- with no rows at all has to be able to farm -- making it a row would mean a
-- missing insert silently locks somebody out of their own barn, and the CHECK
-- above allows the value only so a hand-written repair row is not rejected.

-- Land maintenance, one row per (player, UTC day), holding Bushels paid
-- TOWARD that day's bill.
--
-- A running total rather than a paid/unpaid flag, and that is the whole
-- reason this table has a number in it: the day's bill is not fixed when the
-- day starts. A player who buys a capacity slot at noon owes more for the
-- afternoon than they did for the morning, so settling has to charge the
-- difference. See raise_homestead_upkeep below.
create table public.homestead_upkeep (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  bushels integer not null default 0 check (bushels >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, day)
);

comment on table public.homestead_upkeep is
  'Bushels paid toward one player''s land maintenance on one UTC day. A running total, not a flag -- the day''s bill rises when the farm does. Bushels only: no Gold is ever recorded here. Service-role only.';

alter table public.homestead_upkeep enable row level security;
revoke all on public.homestead_upkeep from anon, authenticated;

-- Raises today's paid total to p_target, and says whether this call is the
-- one that moved it.
--
-- The conditional DO UPDATE is what makes concurrent settlement safe: two
-- requests that both find today unpaid will both have debited their caller,
-- one raises the row and the other gets false and refunds. Two racing on
-- different targets (a capacity purchase landed between them) settle at the
-- higher, and the lower's refund leaves the day slightly under-collected
-- until the next action re-reads it -- a rounding error in the player's
-- favour, which is the correct direction for one to fall.
--
-- Deliberately NOT a CHECK constraint anywhere near this. The repo has
-- recorded the trap twice now (see 20260903120000's own note): a CHECK
-- re-evaluates on every UPDATE, so a row that ever fell out of shape becomes
-- permanently unwritable and 500s that player's farm forever.
create or replace function public.raise_homestead_upkeep(
  p_profile_id uuid,
  p_day date,
  p_target integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  raised integer;
begin
  -- A negative target is a caller bug, not a refusal: it would let a farm's
  -- paid total be walked backwards and the same day billed twice.
  if p_target is null or p_target < 0 then
    raise exception 'Homestead upkeep target must be non-negative, got %', p_target
      using errcode = 'check_violation';
  end if;

  insert into public.homestead_upkeep as u (profile_id, day, bushels)
  values (p_profile_id, p_day, p_target)
  on conflict (profile_id, day) do update
    set bushels = p_target,
        updated_at = now()
    where u.bushels < p_target
  returning u.bushels into raised;

  -- No row came back: today was already settled at or above this target, so
  -- this caller took nothing and must put its debit back.
  return raised is not null;
end;
$$;

comment on function public.raise_homestead_upkeep(uuid, date, integer) is
  'Raises a player''s Bushels-paid total for one UTC day to p_target. Returns true only for the call that actually raised it; false means the day was already settled at least that far and the caller must refund what it debited.';

-- `public` is load-bearing and not redundant: anon and authenticated inherit
-- Postgres's default PUBLIC execute grant, so revoking from the two roles
-- alone leaves the function callable on /rest/v1/rpc. This one is SECURITY
-- DEFINER and takes the profile id as a parameter rather than reading the
-- caller's session, so an anonymous caller reaching it could mark any
-- player's land fee paid for free. All three names matter. Verify with proacl
-- afterwards rather than by re-reading this file; a correct one has no bare
-- `=X/postgres` entry, and get_advisors catches the SECURITY DEFINER case.
revoke all on function public.raise_homestead_upkeep(uuid, date, integer) from public, anon, authenticated;

-- NO BACKFILL, and that is a decision rather than an omission.
--
-- Every player who already keeps stock in a district reads as owning that
-- district, because unlockedSectors derives from their units as well as from
-- this table (lib/stackacres/sectors.ts). So a live farm mid-cattle-cycle
-- keeps Ox Fields with nothing written here, and it keeps working even if a
-- row is later lost. Writing a backfill would add a way for this to be wrong
-- without adding a way for it to be right.
