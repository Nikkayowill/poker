-- StackAcres' equipment ladder: which tool a player has bought up to.
--
-- One row per player, created on the first upgrade. A player with no row is
-- holding the starting Trowel, the same way a missing homestead_feed row is
-- zero servings and a missing homestead_capacity row is zero extra slots --
-- so this needs no backfill and no default row for anybody.
--
-- Table name stays `homestead_*` like every other table in this feature. The
-- 2026-09-03 rename moved every identifier in the app from "homestead" to
-- "stackacres" and deliberately left the DB alone; a new table joining these
-- ones matches its neighbours rather than starting a second convention.
create table public.homestead_tool (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  -- Kept in step with STACKACRES_TOOL_TIERS in lib/stackacres/equipment.ts.
  -- Duplicated on purpose (a constraint cannot import a TypeScript module);
  -- adding a rung to the ladder means a migration that widens this list, and
  -- the service's own `toStackAcresToolTier` degrades an unknown value to the
  -- starting tier rather than throwing if the two ever drift.
  tier text not null check (tier in ('trowel', 'iron-shovel', 'golden-spade')),
  updated_at timestamptz not null default now()
);

comment on table public.homestead_tool is
  'Which rung of the StackAcres equipment ladder a player has bought up to. No row means the free starting Trowel. Service-role only.';

alter table public.homestead_tool enable row level security;
revoke all on public.homestead_tool from anon, authenticated;

-- WHY THIS IS GUARDED ON `p_from` RATHER THAN JUST WRITING `p_to`.
--
-- The caller has already debited Gold by the time it gets here (rule 1 in
-- stackacres-service.ts: the money leaves before the thing it pays for
-- exists), so this write is the settlement, and settlement has to be
-- idempotent under a double tap. Two upgrade requests racing from two tabs
-- both debit, and without the guard both would succeed and the player would
-- pay twice for one rung. With it, exactly one matches `p_from` and the loser
-- gets null back, which the service treats as a lost race and refunds -- the
-- same "a lost race did not happen" posture collect_homestead_unit takes.
--
-- Returns the tier now held, or null when the guard did not match. Note the
-- null case covers BOTH "someone else got there first" and "you are not on
-- the rung you thought you were", which is what makes this safe to call
-- without a separate read-then-write.
create or replace function public.upgrade_homestead_tool(
  p_profile_id uuid,
  p_from text,
  p_to text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_tier text;
begin
  -- Lock this player's rung for the transaction. Nothing else writes this
  -- table, so one lock is the whole concurrency story for a player who
  -- already has a row.
  select tier into current_tier
    from public.homestead_tool
   where profile_id = p_profile_id
   for update;

  if current_tier is null then
    -- No row means the free starting rung, and nothing above it can be
    -- reached from a state that was never written. A caller claiming to
    -- upgrade from anything else is stale.
    if p_from <> 'trowel' then
      return null;
    end if;
    -- FOR UPDATE cannot lock a row that does not exist, so two first-time
    -- upgrades can both arrive here. ON CONFLICT DO NOTHING plus FOUND is
    -- what picks one: the loser inserted nothing and gets the same null a
    -- stale p_from gets.
    insert into public.homestead_tool (profile_id, tier)
    values (p_profile_id, p_to)
    on conflict (profile_id) do nothing;
    if not found then
      return null;
    end if;
    return p_to;
  end if;

  if current_tier <> p_from then
    return null;
  end if;

  update public.homestead_tool
     set tier = p_to,
         updated_at = now()
   where profile_id = p_profile_id
     and tier = p_from;
  if not found then
    return null;
  end if;
  return p_to;
end;
$$;

comment on function public.upgrade_homestead_tool(uuid, text, text) is
  'Advances a player one rung up the StackAcres equipment ladder, guarded on the rung they were last seen holding. Returns the tier now held, or null on a lost race or a stale p_from -- null must never be treated as a purchase.';

-- `public` is load-bearing and not redundant -- anon and authenticated inherit
-- the default PUBLIC execute grant, so revoking from the two roles alone
-- leaves this callable on /rest/v1/rpc. This has shipped wrong twice on this
-- feature already (see 20260901130000_revoke_homestead_function_execute_from_public
-- and 20260813170000); verify with proacl after applying, not by re-reading
-- this file.
revoke all on function public.upgrade_homestead_tool(uuid, text, text) from public, anon, authenticated;
