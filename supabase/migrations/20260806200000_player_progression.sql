-- M18: player progression -- XP, lifetime wagered, daily streak.
--
-- One row per profile, created on first use rather than backfilled: a player
-- who has never wagered is level 1 with nothing to store, and rankProgress(0)
-- in lib/progression/rank.ts already renders exactly that from no row at all.
--
-- There is deliberately no `level` column. levelForXp() in
-- lib/progression/rank.ts derives the level from xp, and storing it too would
-- be a second definition of the ladder -- the drift STAKES_TIERS' consolidation
-- in lib/game/tiers.ts was about. It would also be unwritable without a race:
-- the level a write lands on is not known until after the write, so the caller
-- would have to read back and update again. The award RPC below returns the xp
-- on both sides instead, which is everything rewardsBetween() needs.
--
-- Same access posture as the M15/M16 tables: service role only, from API routes
-- that have already identified the caller by their river_session cookie.

create table public.player_progression (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  xp bigint not null default 0 check (xp >= 0),
  -- Lifetime Gold staked. Never nets out a loss, for the same reason
  -- stats.total_chips_won does not: it is progress, and progress that a losing
  -- session can undo is not progress.
  lifetime_wagered bigint not null default 0 check (lifetime_wagered >= 0),
  -- Consecutive days the daily grant has been claimed.
  streak integer not null default 0 check (streak >= 0),
  -- The UTC day of the last claim, as a date rather than a timestamp: a streak
  -- is a question about calendar days, and comparing dates cannot drift the way
  -- millisecond arithmetic across a boundary does. Matches utcDayKey().
  last_claim_day date,
  updated_at timestamptz not null default now()
);

comment on table public.player_progression is
  'Per-profile XP, lifetime wagered and daily-claim streak. The rank level is derived from xp by lib/progression/rank.ts and is deliberately not stored.';
comment on column public.player_progression.lifetime_wagered is
  'Gold staked, never netted against winnings -- progress a losing session cannot undo.';

-- The readout the lobby polls is by primary key, so no extra index is needed
-- for it. This one is for the "top ranks" reads a leaderboard scope will want.
create index player_progression_xp_idx on public.player_progression(xp desc);

-- ---------------------------------------------------------------------------
-- Awarding XP.
--
-- An RPC rather than a read-then-write for the reason credit_gold became one
-- (20260804160000): two settles landing at once -- a blackjack hand and a
-- roulette spin in two tabs -- both read the same stale xp and the second write
-- drops the first. Here that is a lost level, and a lost level is a lost
-- milestone payout. select ... for update then a qualified UPDATE, in one
-- transaction, so the second call serialises behind the first.
--
-- Returns the xp on both sides so the caller can ask rewardsBetween() what was
-- crossed. Returning only the new total would make "did this award cross a
-- level" unanswerable without a second read that races the next award.
-- ---------------------------------------------------------------------------

create or replace function public.award_progression_xp(
  p_profile_id uuid,
  p_xp bigint,
  p_wagered bigint
)
returns table (previous_xp bigint, new_xp bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous_xp bigint;
  v_new_xp bigint;
begin
  if p_xp is null or p_xp < 0 or p_wagered is null or p_wagered < 0 then
    raise exception 'Invalid progression award' using errcode = '22023';
  end if;

  -- Upsert-then-lock: a first-time player has no row, and creating one inside
  -- the same statement keeps the caller from having to do a check-then-insert
  -- that two concurrent settles would both pass.
  insert into public.player_progression (profile_id)
  values (p_profile_id)
  on conflict (profile_id) do nothing;

  select pp.xp into v_previous_xp
  from public.player_progression as pp
  where pp.profile_id = p_profile_id
  for update;

  update public.player_progression
  set xp = public.player_progression.xp + p_xp,
      lifetime_wagered = public.player_progression.lifetime_wagered + p_wagered,
      updated_at = now()
  where profile_id = p_profile_id
  returning public.player_progression.xp into v_new_xp;

  return query select v_previous_xp, v_new_xp;
end;
$$;

revoke all on function public.award_progression_xp(uuid, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.award_progression_xp(uuid, bigint, bigint)
  to service_role;

-- ---------------------------------------------------------------------------
-- Access.
-- ---------------------------------------------------------------------------

alter table public.player_progression enable row level security;

-- No policies and no grants, matching profile_blocks/friend_requests/
-- friendships/table_invites. RLS is on anyway so that a later grant cannot
-- silently expose the table: with RLS enabled and no policy, a grant alone
-- still returns nothing.
revoke all on public.player_progression from anon, authenticated;
