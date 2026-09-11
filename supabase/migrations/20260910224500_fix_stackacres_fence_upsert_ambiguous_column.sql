-- stackacres_wildlife_defense's three upsert functions all declare
-- RETURNS TABLE(profile_id uuid, zone text, ...), which makes profile_id,
-- zone, segment_index etc. PL/pgSQL variables in scope for the whole
-- function body. Each function's first-write branch then does
-- `on conflict (profile_id, ...)` -- a bare, unqualified column list --
-- which Postgres can't tell apart from those same-named variables, so
-- every attempt to create a brand-new fence segment, predator wave, or
-- livestock health row fails with "column reference \"profile_id\" is
-- ambiguous". Confirmed against the live functions (not just this file)
-- with a throwaway temp-table repro, rolled back after.
--
-- The usual fix elsewhere in this repo is renaming the colliding local
-- variable (see stackacres_units_fix_extra_slots_ambiguous), but these
-- names come from RETURNS TABLE, and callers (stackacres-defense-store.ts)
-- read the RPC response by those exact column names -- renaming them would
-- just move the break to the client. Naming the conflict target by its
-- constraint instead of a column list sidesteps the ambiguity without
-- touching any name a caller depends on.

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
      on conflict on constraint stackacres_fence_segments_pkey do nothing
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
      on conflict on constraint stackacres_predator_waves_pkey do nothing
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
      on conflict on constraint stackacres_livestock_health_pkey do nothing
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
