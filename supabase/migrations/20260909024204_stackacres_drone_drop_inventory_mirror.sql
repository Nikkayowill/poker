-- Drop the homestead_inventory "compliance mirror" from both drone RPCs.
--
-- 20260906150000_stackacres_forage_drone.sql made deploy_stackacres_drone
-- and collect_stackacres_drone_forage each write a second, never-read row
-- into the dead barn-era homestead_inventory table. The deploy side wrote
-- the fee as a NEGATIVE delta, and that table has a quantity >= 0 check.
-- adjust_homestead_inventory clamps a first insert to 0, so the first drone
-- went through, but the second deploy tried to update 0 to -cost, tripped
-- the check, and rolled back the whole purchase. Nothing reads either row,
-- so the fix is to stop writing them. The real ledger was always
-- spend_gold_by_profile / credit_gold_by_profile and is unchanged here.
--
-- The two existing mirror rows are left in place; they are inert.

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

  return query select true, 'deployed', v_new_id, v_spend.gold_balance;
end;
$$;

comment on function public.deploy_stackacres_drone(uuid, integer) is
  'Debits the flat drone deploy fee and creates the ownership row atomically. Returns success=false with reason=insufficient_gold rather than raising, so the caller can render an ordinary refusal.';

revoke all on function public.deploy_stackacres_drone(uuid, integer) from public, anon, authenticated;
grant execute on function public.deploy_stackacres_drone(uuid, integer) to service_role;

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
      -- is unreachable in practice; kept as a defined answer rather than an
      -- unhandled null, same as every other RPC here.
      return query select false, 'no_such_profile', 0, v_credit.gold_balance;
      return;
    end if;
    return query select true, 'collected', v_reward, v_credit.gold_balance;
  else
    select p.gold_balance into v_credit from public.profiles as p where p.id = p_profile_id;
    return query select true, 'collected', 0, v_credit.gold_balance;
  end if;
end;
$$;

comment on function public.collect_stackacres_drone_forage(uuid, uuid, integer, integer, integer) is
  'Atomically claims one forage pickup for a drone the caller owns: locks the drone row, refuses a claim inside its own cooldown, rolls the Gold reward, and credits it, all in one transaction so a doubled request cannot pay twice.';

revoke all on function public.collect_stackacres_drone_forage(uuid, uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.collect_stackacres_drone_forage(uuid, uuid, integer, integer, integer) to service_role;
