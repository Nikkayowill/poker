-- StackAcres travelers story: per-profile quest progress for Great-Grandpa
-- Ray and the ten dimension travelers (lib/stackacres/story/). One row per
-- profile holding the whole StoredStory as jsonb, moved only by the pure
-- reducers in lib/stackacres/story/state.ts and written back under a
-- version guard. Rewards are story items inside that same json, never Gold
-- (see that module's own header on the currency wall).
--
-- NAME CHECKED AGAINST THE LIVE SCHEMA: homestead_story,
-- write_homestead_story and turn_in_homestead_story_quest are all free.
--
-- Two functions rather than plain table writes from the application, for
-- the same reason give_homestead_gift (20260906140000) is one function: a
-- quest turn-in that hands over items must debit those items and advance
-- the story in ONE transaction, or a hiccup between the two could spend a
-- player's potatoes for a quest that was never recorded. The version guard
-- is what stops two tabs each advancing the same quest off the same read.

create table public.homestead_story (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  story jsonb not null,
  version integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now()
);

comment on table public.homestead_story is
  'StackAcres travelers story: per-player quest progress and story items as one jsonb document, version-guarded. Service-role only.';

alter table public.homestead_story enable row level security;
revoke all on public.homestead_story from anon, authenticated;

-- Writes the whole document if and only if the row is still at
-- p_expected_version (0 means "no row yet"). Returns the new version, or
-- null when someone else moved it first -- the caller re-reads and retries.
create or replace function public.write_homestead_story(
  p_profile_id uuid,
  p_story jsonb,
  p_expected_version integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v integer;
begin
  if p_expected_version = 0 then
    insert into public.homestead_story (profile_id, story, version, updated_at)
    values (p_profile_id, p_story, 1, now())
    on conflict (profile_id) do nothing
    returning version into v;
    return v;
  end if;

  update public.homestead_story
     set story = p_story,
         version = version + 1,
         updated_at = now()
   where profile_id = p_profile_id
     and version = p_expected_version
  returning version into v;
  return v;
end;
$$;

comment on function public.write_homestead_story(uuid, jsonb, integer) is
  'Version-guarded write of a player''s whole story document. Returns the new version, or null on a lost race.';

-- A quest turn-in: the same guarded write, plus every deliver objective's
-- debit against homestead_processing_inventory, all or nothing. p_debits is
-- a json array of {item, quantity}. Returns 'ok', 'conflict' (the version
-- moved; nothing written) or 'insufficient' (an item was short; nothing
-- written, including the story -- the EXCEPTION block rolls the update
-- back).
create or replace function public.turn_in_homestead_story_quest(
  p_profile_id uuid,
  p_story jsonb,
  p_expected_version integer,
  p_debits jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v integer;
  d jsonb;
  remaining integer;
begin
  v := public.write_homestead_story(p_profile_id, p_story, p_expected_version);
  if v is null then
    return 'conflict';
  end if;

  for d in select * from jsonb_array_elements(coalesce(p_debits, '[]'::jsonb)) loop
    remaining := null;
    update public.homestead_processing_inventory
       set quantity = quantity - (d->>'quantity')::integer,
           updated_at = now()
     where profile_id = p_profile_id
       and item = d->>'item'
       and quantity >= (d->>'quantity')::integer
    returning quantity into remaining;
    if remaining is null then
      raise exception 'homestead_story_insufficient' using errcode = 'P0001';
    end if;
  end loop;

  return 'ok';
exception
  when raise_exception then
    if sqlerrm = 'homestead_story_insufficient' then
      return 'insufficient';
    end if;
    raise;
end;
$$;

comment on function public.turn_in_homestead_story_quest(uuid, jsonb, integer, jsonb) is
  'Advances a player''s story document and debits the quest''s delivered items atomically. Returns ok, conflict or insufficient; nothing is written on either refusal.';

-- `public` is load-bearing here, not redundant with anon/authenticated: see
-- reference_stackchips_revoke_execute_from_public -- omitting it has shipped
-- a SECURITY DEFINER function anonymously callable on /rest/v1/rpc before.
revoke all on function public.write_homestead_story(uuid, jsonb, integer) from public, anon, authenticated;
revoke all on function public.turn_in_homestead_story_quest(uuid, jsonb, integer, jsonb) from public, anon, authenticated;
