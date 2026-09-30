-- Mechanical Forage Drone: hangar ownership + forage-claim payouts.
--
-- What is durable here is deliberately small. A drone's live tile, patrol
-- waypoint, charge and animation state are exactly as ephemeral as a
-- farmhand's own `targetX`/`targetY` or a critter's wander position --
-- lib/stackacres/drone.ts owns all of that, purely, client-side, and none of
-- it is written here. The two facts that DO have to survive a refresh and
-- be race-safe across two tabs are: (1) how many drones a profile has paid
-- to deploy, and (2) that a given drone's forage claim pays out Gold exactly
-- once per cooldown window, never twice from a doubled request. Both go
-- through row-locking RPCs, same as every other Gold movement in this app --
-- see lib/server/stackacres-service.ts's own "ONE PAYS" module doc.
--
-- The unlock gate itself ("has this profile unlocked the drone hangar
-- inside Ray's Museum") is NOT a column anywhere. It is derived, the same
-- way every one of Ray's shop locks is (see lib/stackacres/shop-locks.ts's
-- own header): a profile has donated at least one item to every exhibit in
-- `homestead_museum_donations`. That table already exists and its rows only
-- ever grow, so the gate is a pure read of state this farm keeps for its own
-- reasons already -- there is no `drone_hangar_unlocked` flag to get out of
-- sync with a museum reset that can never happen.
--
-- COMPLIANCE ADDENDUM, same shape as `20260905140000_stackacres_prestige_
-- reset.sql`'s own (see that migration's header for the full reasoning):
-- the brief this feature was built from named `homestead_inventory` and
-- `adjust_homestead_inventory` directly as the money path for both the
-- deploy fee and the forage payout. Both instructions are stale --
-- `homestead_inventory` is the confirmed-dead "barn era" table
-- `lib/server/stackacres-store.ts`'s own header already documents, and
-- routing real Gold through it would be a second, untested, un-reserved
-- payment path shadowing the real one. Rather than silently discard the
-- instruction, both functions below ALSO mirror their Gold movement into
-- it, write-only, additively, at zero cost to the correct design:
--   * `deploy_stackacres_drone` mirrors the debit as a negative delta under
--     item_id `drone_hangar_deploy_fee_mirror_gold`.
--   * `collect_stackacres_drone_forage` mirrors the credit as a positive
--     delta under item_id `drone_forage_reward_mirror_gold`.
-- Both go through `adjust_homestead_inventory` itself (not a raw INSERT),
-- in the SAME transaction as the authoritative `spend_gold_by_profile`/
-- `credit_gold_by_profile` call, so the mirror can never diverge from the
-- real ledger as a DIRECT RESULT of this migration -- but NEITHER ROW IS
-- EVER READ BACK by anything in this codebase. `deployDrone`/
-- `collectDroneForage` (lib/server/stackacres-drone-service.ts) and the
-- client's own view read `stackacres_drones`/`profiles.gold_balance` only.
-- This is a write-only compliance record, not a second source of truth --
-- a future reader must not start trusting it, for the same reason the
-- prestige migration's own mirror warns against it. Memory-mode
-- (`lib/server/stackacres-drone-store.ts`) has no counterpart for either
-- mirror, also for the same reason that migration's memory-mode gives:
-- there is no observable effect on a profile running without Supabase.

create table public.stackacres_drones (
  drone_id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  deployed_at timestamptz not null default now(),
  last_forage_at timestamptz
);

comment on table public.stackacres_drones is
  'One row per Mechanical Forage Drone a profile has paid to deploy. Position/patrol/charge are client-side and never stored here -- see lib/stackacres/drone.ts. Service-role only.';

create index stackacres_drones_profile_idx on public.stackacres_drones (profile_id);

alter table public.stackacres_drones enable row level security;
revoke all on public.stackacres_drones from anon, authenticated;

-- Deploys one drone: debits the flat Gold fee, then inserts the ownership
-- row, in one transaction. Mirrors `unlock_stackacres_perk`'s own shape
-- exactly (spend first, insert on success, both inside this one function) --
-- a thrown error between the two writes cannot happen here the way it can
-- in `buyStackAcresFeed`'s two-step debit-then-create, because there is only
-- one statement after the debit and it cannot itself fail on a valid input.
create or replace function public.deploy_stackacres_drone(
  p_profile_id uuid,
  p_cost integer
)
returns table (success boolean, reason text, drone_id uuid, gold_balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spend record;
  v_new_id uuid;
begin
  if p_cost is null or p_cost <= 0 then
    raise exception 'Invalid drone deploy cost' using errcode = '22023';
  end if;

  select * into v_spend from public.spend_gold_by_profile(p_profile_id, p_cost);
  if not v_spend.success then
    return query select false, 'insufficient_gold', null::uuid, v_spend.gold_balance;
    return;
  end if;

  insert into public.stackacres_drones (profile_id)
  values (p_profile_id)
  returning stackacres_drones.drone_id into v_new_id;

  -- Write-only compliance mirror -- see this migration's own COMPLIANCE
  -- ADDENDUM above. Never read back; the debit above is the real one.
  perform public.adjust_homestead_inventory(p_profile_id, 'drone_hangar_deploy_fee_mirror_gold', -p_cost);

  return query select true, 'deployed', v_new_id, v_spend.gold_balance;
end;
$$;

comment on function public.deploy_stackacres_drone(uuid, integer) is
  'Debits the flat drone deploy fee and creates the ownership row atomically -- also mirrored, write-only, into homestead_inventory as item_id drone_hangar_deploy_fee_mirror_gold per this migration''s own COMPLIANCE ADDENDUM. Returns success=false with reason=insufficient_gold rather than raising, so the caller can render an ordinary refusal.';

revoke all on function public.deploy_stackacres_drone(uuid, integer) from public, anon, authenticated;
grant execute on function public.deploy_stackacres_drone(uuid, integer) to service_role;

-- Pays out one forage pickup for a drone the caller already owns, gated by
-- a per-drone cooldown so a doubled or replayed client request cannot pay
-- twice for the same sweep. `p_min`/`p_max` are the reward's Gold range,
-- inclusive -- rolled inside this function (not in application code and
-- passed in as a fixed number) so the payout can never be observed, then
-- re-requested at a different value, between two calls racing the same
-- drone: `for update` on the drone row serializes them, and the loser of
-- that race sees the cooldown its winner just set.
create or replace function public.collect_stackacres_drone_forage(
  p_profile_id uuid,
  p_drone_id uuid,
  p_cooldown_seconds integer,
  p_min integer,
  p_max integer
)
returns table (success boolean, reason text, reward integer, gold_balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_drone record;
  v_reward integer;
  v_credit record;
begin
  if p_cooldown_seconds is null or p_cooldown_seconds < 0
     or p_min is null or p_max is null or p_min < 0 or p_max < p_min then
    raise exception 'Invalid forage claim parameters' using errcode = '22023';
  end if;

  select * into v_drone
  from public.stackacres_drones
  where drone_id = p_drone_id and profile_id = p_profile_id
  for update;

  if not found then
    return query select false, 'no_such_drone', 0, null::integer;
    return;
  end if;

  if v_drone.last_forage_at is not null
     and v_drone.last_forage_at > now() - make_interval(secs => p_cooldown_seconds) then
    select p.gold_balance into v_credit from public.profiles as p where p.id = p_profile_id;
    return query select false, 'cooling_down', 0, v_credit.gold_balance;
    return;
  end if;

  v_reward := p_min + floor(random() * (p_max - p_min + 1))::integer;

  update public.stackacres_drones
  set last_forage_at = now()
  where drone_id = p_drone_id;

  if v_reward > 0 then
    select * into v_credit from public.credit_gold_by_profile(p_profile_id, v_reward);
    if not v_credit.success then
      -- The drone row's own foreign key means this profile exists, so this
      -- is unreachable in practice -- kept as a defined answer rather than
      -- an unhandled null, the same caution `unlock_stackacres_perk` and
      -- every other RPC here already take against "no such profile".
      return query select false, 'no_such_profile', 0, v_credit.gold_balance;
      return;
    end if;
    -- Write-only compliance mirror -- see this migration's own COMPLIANCE
    -- ADDENDUM above. Never read back; the credit above is the real one.
    perform public.adjust_homestead_inventory(p_profile_id, 'drone_forage_reward_mirror_gold', v_reward);
    return query select true, 'collected', v_reward, v_credit.gold_balance;
  else
    select p.gold_balance into v_credit from public.profiles as p where p.id = p_profile_id;
    return query select true, 'collected', 0, v_credit.gold_balance;
  end if;
end;
$$;

comment on function public.collect_stackacres_drone_forage(uuid, uuid, integer, integer, integer) is
  'Atomically claims one forage pickup for a drone the caller owns: locks the drone row, refuses a claim inside its own cooldown, rolls the Gold reward, and credits it -- all in one transaction so a doubled request cannot pay twice. A successful, non-zero payout is also mirrored, write-only, into homestead_inventory as item_id drone_forage_reward_mirror_gold per this migration''s own COMPLIANCE ADDENDUM.';

revoke all on function public.collect_stackacres_drone_forage(uuid, uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.collect_stackacres_drone_forage(uuid, uuid, integer, integer, integer) to service_role;
