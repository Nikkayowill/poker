-- A per-profile "how fresh is this" counter for the StackAcres action route.
--
-- WHY THIS EXISTS. Every action's response is a full farm view (`view()` in
-- lib/server/stackacres-service.ts), built from a live re-read of the DB at
-- the moment that one request finishes. Two actions in flight at once (water
-- a crop, feed a hen) race each other's reads independently, so their
-- responses can arrive at the client in an order that does not match which
-- one actually finished last -- and the client used to trust whichever
-- response landed most recently, letting a stale one clobber a fresher one
-- and flash the older state back onscreen for a moment.
--
-- This table gives every completed action a strictly increasing number, so
-- the client can instead trust whichever response carries the HIGHEST number
-- regardless of arrival order. See lib/server/stackacres-revision-store.ts
-- for the read/bump pair this backs, and stackacres-farm.tsx's `applyResponse`
-- for the client-side guard.
create table public.homestead_action_revisions (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  rev bigint not null default 0
);

comment on table public.homestead_action_revisions is
  'One monotonic counter per profile, bumped once per completed StackAcres action. Written only by the service role, via lib/server/stackacres-revision-store.ts. The number itself carries no meaning beyond "higher is fresher" -- the client uses it to drop an out-of-order response rather than let it revert newer state.';

alter table public.homestead_action_revisions enable row level security;
-- `public` as well as anon/authenticated: omitting it leaves a grant that
-- makes the table reachable anonymously. See homestead_action_keys' own
-- migration and this repo's history of that exact omission.
revoke all on public.homestead_action_revisions from public, anon, authenticated;

-- No policies: service-role only, same posture as homestead_units.

-- The bump has to be one atomic round trip -- a plain read-then-write from
-- the store would race itself the same way the client-visible bug does.
-- `on conflict ... do update` under Postgres's own row lock is what makes two
-- concurrent bumps for the same profile come out as two different numbers
-- rather than a lost update.
create or replace function public.bump_homestead_action_revision(p_profile_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  next_rev bigint;
begin
  insert into public.homestead_action_revisions (profile_id, rev)
  values (p_profile_id, 1)
  on conflict (profile_id) do update set rev = homestead_action_revisions.rev + 1
  returning rev into next_rev;
  return next_rev;
end;
$$;

revoke execute on function public.bump_homestead_action_revision(uuid)
  from public, anon, authenticated;
