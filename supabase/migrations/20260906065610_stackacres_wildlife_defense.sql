-- Wildlife Ecosystem & Nighttime Predator Defense: fence tier/durability
-- per segment, one Predator Wave per player, and per-district livestock
-- health.
--
-- A DELIBERATELY NEW SET OF TABLES, not folded into `homestead_units`/
-- `homestead_plots`/`homestead_inventory`. None of those carry a position
-- (see 20260903180000_stackacres_units's own header: "StackAcres drops the
-- plot grid"), and this feature's whole job is spatial -- a fence segment
-- is geometry (lib/stackacres/wildlife.ts's `fenceSegmentsForZone`), and a
-- predator's target is a district's `growAreaBounds` rect, not a unit row.
-- Also not `homestead_inventory`, the documented decade-dead leftover
-- table flagged in the crossbreeding migration's own header -- this is the
-- second time a StackAcres feature has had to say so.
--
-- LIVESTOCK HEALTH IS PER DISTRICT, NOT PER UNIT, for the same reason: a
-- `homestead_units` row has no coordinate to attach damage to, and a
-- predator's actual target is a district's grow area as a whole (see
-- `defenseTargetRects`), not any one animal in it.
--
-- Same core invariant every other StackAcres store carries: a write is a
-- version-guarded UPDATE/INSERT, and a lost race (zero rows back) must
-- never be treated as a successful write -- see
-- lib/server/stackacres-defense-store.ts's own header for the RPC/memory
-- twin-branch shape this mirrors from stackacres-crossbreeding-store.ts.
--
-- No real currency moves here (this feature has no Gold cost or payout of
-- its own), but the version-guard discipline still matters: a lost race
-- silently reviving a fence a predator just broke, or double-crediting
-- battle damage, is the same class of bug a lost race in a money path is,
-- just against game state instead of a balance.

create table public.stackacres_fence_segments (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  zone text not null check (zone in ('farmstead', 'meadow', 'oxfields', 'wallow')),
  -- One `FENCE_BAY`-sized bay along a district's perimeter walk (see
  -- `fenceSegmentsForZone`'s own top/bottom/left/right edge order) --
  -- derived geometry, not a stored position; this row only ever needs the
  -- index to key back into that same deterministic walk.
  segment_index int not null check (segment_index >= 0),
  tier text not null default 'wood' check (tier in ('wood', 'wire', 'steel')),
  durability int not null check (durability >= 0),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, zone, segment_index)
);

comment on table public.stackacres_fence_segments is
  'One StackAcres fence bay''s tier and remaining durability. A missing row means Basic Wood at full durability (version 0) -- see stackacres-defense-store.ts''s defaultFenceSegment. Service-role only.';

alter table public.stackacres_fence_segments enable row level security;
revoke all on public.stackacres_fence_segments from anon, authenticated;

create table public.stackacres_predator_waves (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  active boolean not null default false,
  -- Small (a handful of predators at most) and read/written as one unit by
  -- the manager that owns it -- see stackacres-defense-store.ts's own
  -- header for why this is one coarse row rather than one row per
  -- predator.
  predators jsonb not null default '[]'::jsonb,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

comment on table public.stackacres_predator_waves is
  'Tonight''s live predator entities for one player, saved wholesale by the WildlifeManager. Service-role only.';

alter table public.stackacres_predator_waves enable row level security;
revoke all on public.stackacres_predator_waves from anon, authenticated;

create table public.stackacres_livestock_health (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  zone text not null check (zone in ('farmstead', 'meadow', 'oxfields', 'wallow')),
  health int not null default 100 check (health >= 0 and health <= 100),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, zone)
);

comment on table public.stackacres_livestock_health is
  'One district''s livestock health for one player -- see this migration''s own header for why health is tracked per district, not per homestead_units row. A missing row means full health (version 0).';

alter table public.stackacres_livestock_health enable row level security;
revoke all on public.stackacres_livestock_health from anon, authenticated;

/* -------------------------------------------------------------------- */
/* Version-guarded writes                                                */
/* -------------------------------------------------------------------- */

/**
 * Writes one fence segment's tier/durability, used for both an upgrade
 * (new tier, full durability) and battle damage (same tier, reduced
 * durability) -- both are "replace this segment's stored state, guarded
 * on the version I last read". `p_expected_version = 0` means "no row
 * exists yet"; that branch inserts and returns zero rows if a concurrent
 * writer already created the row first, the same "lost the race to be
 * first" signal an ordinary version mismatch gives on the update branch.
 */
create or replace function public.upsert_stackacres_fence_segment(
  p_profile_id uuid,
  p_zone text,
  p_segment_index int,
  p_expected_version bigint,
  p_tier text,
  p_durability int
)
returns table(profile_id uuid, zone text, segment_index int, tier text, durability int, version bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_expected_version = 0 then
    return query
      insert into public.stackacres_fence_segments as f (profile_id, zone, segment_index, tier, durability, version)
      values (p_profile_id, p_zone, p_segment_index, p_tier, p_durability, 1)
      on conflict (profile_id, zone, segment_index) do nothing
      returning f.profile_id, f.zone, f.segment_index, f.tier, f.durability, f.version, f.updated_at;
    return;
  end if;

  return query
    update public.stackacres_fence_segments as f
       set tier = p_tier,
           durability = p_durability,
           version = f.version + 1,
           updated_at = now()
     where f.profile_id = p_profile_id
       and f.zone = p_zone
       and f.segment_index = p_segment_index
       and f.version = p_expected_version
    returning f.profile_id, f.zone, f.segment_index, f.tier, f.durability, f.version, f.updated_at;
end;
$$;

comment on function public.upsert_stackacres_fence_segment(uuid, text, int, bigint, text, int) is
  'Version-guarded write of one fence segment''s tier/durability (upgrade or battle damage). Zero rows back means a lost race; the caller must never treat that as success.';

revoke execute on function public.upsert_stackacres_fence_segment(uuid, text, int, bigint, text, int)
  from public, anon, authenticated;

create or replace function public.save_stackacres_predator_wave(
  p_profile_id uuid,
  p_expected_version bigint,
  p_active boolean,
  p_predators jsonb
)
returns table(profile_id uuid, active boolean, predators jsonb, version bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_expected_version = 0 then
    return query
      insert into public.stackacres_predator_waves as w (profile_id, active, predators, version)
      values (p_profile_id, p_active, p_predators, 1)
      on conflict (profile_id) do nothing
      returning w.profile_id, w.active, w.predators, w.version, w.updated_at;
    return;
  end if;

  return query
    update public.stackacres_predator_waves as w
       set active = p_active,
           predators = p_predators,
           version = w.version + 1,
           updated_at = now()
     where w.profile_id = p_profile_id
       and w.version = p_expected_version
    returning w.profile_id, w.active, w.predators, w.version, w.updated_at;
end;
$$;

comment on function public.save_stackacres_predator_wave(uuid, bigint, boolean, jsonb) is
  'Version-guarded replace of one player''s whole live predator wave. Zero rows back means a lost race.';

revoke execute on function public.save_stackacres_predator_wave(uuid, bigint, boolean, jsonb)
  from public, anon, authenticated;

create or replace function public.apply_stackacres_livestock_damage(
  p_profile_id uuid,
  p_zone text,
  p_expected_version bigint,
  p_health int
)
returns table(profile_id uuid, zone text, health int, version bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_expected_version = 0 then
    return query
      insert into public.stackacres_livestock_health as h (profile_id, zone, health, version)
      values (p_profile_id, p_zone, p_health, 1)
      on conflict (profile_id, zone) do nothing
      returning h.profile_id, h.zone, h.health, h.version, h.updated_at;
    return;
  end if;

  return query
    update public.stackacres_livestock_health as h
       set health = p_health,
           version = h.version + 1,
           updated_at = now()
     where h.profile_id = p_profile_id
       and h.zone = p_zone
       and h.version = p_expected_version
    returning h.profile_id, h.zone, h.health, h.version, h.updated_at;
end;
$$;

comment on function public.apply_stackacres_livestock_damage(uuid, text, bigint, int) is
  'Version-guarded write of one district''s livestock health. Zero rows back means a lost race.';

-- `public` is load-bearing and not redundant -- anon and authenticated
-- inherit Postgres's default PUBLIC execute grant, so revoking from the
-- two roles alone leaves this callable on /rest/v1/rpc. Verify with
-- get_advisors after applying, not by re-reading this file (see
-- reference_stackchips_revoke_execute_from_public -- this exact omission
-- has shipped wrong twice already on this feature set).
revoke execute on function public.apply_stackacres_livestock_damage(uuid, text, bigint, int)
  from public, anon, authenticated;
