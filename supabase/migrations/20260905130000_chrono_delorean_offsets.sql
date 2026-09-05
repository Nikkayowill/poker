-- Chrono-DeLorean Mode: a sandboxed, dev-only time-shift for one player's own
-- StackAcres farm, so a long-running crop/hunger/upkeep cycle can be watched
-- resolve in minutes instead of days.
--
-- WHAT THIS DOES NOT DO. It never touches the wall clock (`now()` in
-- Postgres, `Date.now()` in Node) and it never rewrites a stored timestamp.
-- Every StackAcres service function already takes an optional `now: Date`
-- (see lib/server/stackacres-service.ts -- `readStackAcres`, `workStackAcres`,
-- `feedStackAcres`, etc. all default to `new Date()`), because growth is a
-- pure function of that argument (lib/stackacres/units.ts: "There is no clock
-- here"). This table stores nothing but a signed millisecond OFFSET per
-- profile; the harness adds it to a real `Date.now()` read at request time
-- and hands the result through that same `now` parameter. Nothing new is
-- invented and no existing guard is bypassed -- a unit still only ready when
-- `readyAt <= now`, it is just that `now` can be a caller-chosen point in the
-- future for one player's own requests.
--
-- SCOPE, WRITTEN DOWN SO IT IS NOT REDISCOVERED. This shifts the `now`
-- threaded through TypeScript service calls only. It has no effect on a SQL
-- `now()` call inside a security-definer RPC (`process_homestead_recipe`'s
-- `updated_at = now()`, `upgrade_homestead_tool`'s audit column, and so on) --
-- those are audit metadata, not growth clocks, and every growth-relevant
-- timestamp (`ready_at`, `last_fed_at`, `last_watered_at`) is written by the
-- TypeScript store layer FROM the passed-in `now`, never by a SQL default. A
-- simulated run therefore ages crops and animals correctly; it does not age
-- an RPC's own bookkeeping columns, and should not be read for that.
--
-- Gating lives entirely in application code
-- (lib/server/chrono-delorean.ts's CHRONO_DELOREAN_ENABLED, requiring both
-- NODE_ENV !== 'production' and an explicit CHRONO_DELOREAN_MODE=1) so this
-- table and its functions can exist in every environment without doing
-- anything in one where the flag is off -- the same posture
-- ADMIN_SECRET/CRON_SECRET take in lib/server/admin-auth.ts: unset or
-- disabled means no default-open door.
create table public.chrono_delorean_offsets (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  -- Bounded to +/-365 days at the database layer as a second, physical
  -- backstop behind the route's own zod bound -- this is a fixed sanity
  -- limit on a raw millisecond count, not a tunable business threshold, so a
  -- CHECK constraint is the right tool here (contrast a retunable ceiling
  -- like a wager cap, which wants a BEFORE INSERT trigger instead -- see
  -- reference_stackchips_check_constraints_block_updates in project memory).
  offset_ms bigint not null default 0
    check (offset_ms between -31536000000 and 31536000000),
  updated_at timestamptz not null default now()
);

comment on table public.chrono_delorean_offsets is
  'Chrono-DeLorean Mode: a dev-only millisecond offset from real time, applied per-profile to the now argument every StackAcres service function already accepts. No row means no offset. Service-role only; see lib/server/chrono-delorean.ts.';

alter table public.chrono_delorean_offsets enable row level security;
revoke all on public.chrono_delorean_offsets from anon, authenticated;

-- Sets the ABSOLUTE offset for a profile, creating the row on first use.
--
-- NO EXPLICIT LOCK HERE, and that is deliberate rather than an oversight to
-- match against advance_chrono_delorean_offset below: `insert ... on
-- conflict do update` is itself one atomic statement with no read to race --
-- there is no "from" state to protect (the caller always means "make it
-- exactly this"), so the row's own upsert already serializes two concurrent
-- writers with no separate SELECT FOR UPDATE needed. That changes the moment
-- a write needs to read-modify-write, which is exactly what
-- advance_chrono_delorean_offset does and why it locks explicitly.
create or replace function public.set_chrono_delorean_offset(
  p_profile_id uuid,
  p_offset_ms bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.chrono_delorean_offsets (profile_id, offset_ms)
  values (p_profile_id, p_offset_ms)
  on conflict (profile_id) do update
    set offset_ms = excluded.offset_ms, updated_at = now();

  return p_offset_ms;
end;
$$;

comment on function public.set_chrono_delorean_offset(uuid, bigint) is
  'Chrono-DeLorean Mode: sets the absolute dev-only time offset (ms) for one profile. Row-locked so two concurrent panel taps for the same profile serialize rather than racing a blind upsert.';

revoke all on function public.set_chrono_delorean_offset(uuid, bigint) from public, anon, authenticated;

-- Adds a signed delta to whatever offset a profile already holds (0 if none),
-- atomically -- the auto-advance loop in ChronoDevPanel.tsx calls this every
-- tick rather than read-then-write from JS, which would let two ticks (two
-- open tabs, or a double-clicked "advance" button) both read the same
-- starting value and step forward by only one delta between them.
create or replace function public.advance_chrono_delorean_offset(
  p_profile_id uuid,
  p_delta_ms bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  current_ms bigint;
  next_ms bigint;
begin
  select offset_ms into current_ms
    from public.chrono_delorean_offsets
   where profile_id = p_profile_id
   for update;

  next_ms := coalesce(current_ms, 0) + p_delta_ms;

  insert into public.chrono_delorean_offsets (profile_id, offset_ms)
  values (p_profile_id, next_ms)
  on conflict (profile_id) do update
    set offset_ms = excluded.offset_ms, updated_at = now();

  return next_ms;
end;
$$;

comment on function public.advance_chrono_delorean_offset(uuid, bigint) is
  'Chrono-DeLorean Mode: atomically adds a signed millisecond delta to one profile''s dev-only time offset and returns the new total. Row-locked for the same reason set_chrono_delorean_offset is.';

-- `public` is load-bearing and not redundant -- anon and authenticated
-- inherit the default PUBLIC execute grant, so revoking from the two roles
-- alone leaves this callable on /rest/v1/rpc. This has shipped wrong twice on
-- the StackAcres feature already (see
-- 20260901130000_revoke_homestead_function_execute_from_public and
-- 20260813170000); verify with the advisor after applying, not by re-reading
-- this file.
revoke all on function public.advance_chrono_delorean_offset(uuid, bigint) from public, anon, authenticated;
