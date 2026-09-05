-- The Sunlight Forge: permanent enchantments layered onto the equipment
-- ladder (lib/stackacres/equipment.ts).
--
-- STORAGE SHAPE, AND WHY IT IS ITS OWN TABLE RATHER THAN `homestead_inventory`.
-- The barn-era `homestead_inventory` (profile_id, item_id, quantity) is
-- INERT -- the single-currency change deleted its only writers, the same
-- as `homestead_plots`. Two independent StackAcres features have already
-- reached for it and both said no in their own migration/commit: the
-- Synergy Tree (20260904200000_stackacres_synergy_tree.sql) built
-- `stackacres_perk_unlocks` instead, and "Ray's Museum secret wing" (PR
-- #334) built `homestead_museum_secrets` "rather than the old barn-era
-- adjust_homestead_inventory, which is dead and shouldn't be resurrected."
-- Writing a permanent enchantment into `homestead_inventory` would make a
-- table nothing else reads or reasons about silently live again, with no
-- test or code path guarding what "inert" was supposed to mean, and there is
-- no CHECK constraint anywhere to stop an enchant item_id from colliding
-- with a stale row already sitting in it from the barn era.
--
-- So this table copies `stackacres_perk_unlocks`'s exact shape (owned/
-- not-owned, quantity 0 or 1, kept as an integer rather than boolean for the
-- same future-ranked-perk reason that table's own comment states) rather
-- than extending it: a Synergy perk is a skill archetype slotted into a
-- per-session loadout, an enchantment is a permanent modifier to whichever
-- equipment tier is currently held, and the two are unrelated eligibility
-- questions that would tangle a single table's `item_id` namespace for no
-- reason.
--
-- THERE IS NO PER-TOOL-INSTANCE ROW, AND THAT IS DELIBERATE, NOT A GAP. The
-- live equipment ladder (`homestead_tool`, 20260904120000_stackacres_tool_tier.sql)
-- has exactly one scalar `tier` column per profile -- there is no tool
-- entity to attach metadata to, only a rung the account has bought up to.
-- An enchantment purchased here is therefore profile-scoped and applies to
-- whichever tier the profile currently holds, exactly like a Synergy perk
-- is profile-scoped and applies regardless of which tier is held. If a
-- future design wants a tier-specific enchantment (e.g. only the Golden
-- Spade can be enchanted), that is a `min_tier` column added to the
-- TypeScript catalogue (lib/stackacres/forge.ts), gated in
-- `computeForgedToolStats`, not a schema change here -- the same way
-- `STACKACRES_TOOL_TIER_DEFS` gates the crit/reach numbers already.
create table public.stackacres_tool_enchantments (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, item_id)
);

comment on table public.stackacres_tool_enchantments is
  'Permanently-owned Sunlight Forge tool enchantments, one row per profile/enchantment (item_id e.g. ''enchant_crit_window_v1''), quantity 0 or 1. Applies to whichever equipment tier (homestead_tool) the profile currently holds -- there is no per-tool-instance row. See lib/stackacres/forge.ts. Service-role only.';

alter table public.stackacres_tool_enchantments enable row level security;
revoke all on public.stackacres_tool_enchantments from anon, authenticated;

-- Forges (permanently buys) one enchantment, spending Gold AND a processing-
-- track material (lib/stackacres/machine-items.ts) in one transaction.
--
-- WHY THIS NEEDS ITS OWN FUNCTION RATHER THAN unlock_stackacres_perk PLUS A
-- SEPARATE adjust_homestead_processing_inventory CALL. A perk unlock spends
-- exactly one resource (Gold), so unlock_stackacres_perk can spend it and
-- then unconditionally grant -- nothing past that point can fail for
-- insufficiency. Forging spends TWO resources that can each independently
-- be insufficient, and a caller doing two round trips (spend material, then
-- try to spend Gold) risks exactly the bug money-ordering rule 1 exists to
-- prevent: a debited material with nothing granted and no atomic rollback
-- if the second spend fails. This function checks BOTH resources are
-- available, under lock, BEFORE mutating either one, so there is no
-- intermediate state where one resource is spent and the purchase still
-- fails.
--
-- ROW-LOCKING SEQUENCE (verify-then-mutate, never mutate-then-check):
--   1. Lock this profile's enchantment-ownership row (FOR UPDATE). If
--      already owned, return immediately -- no lock is held past this
--      statement, nothing else has been touched.
--   2. Lock this profile's material-inventory row (FOR UPDATE) and read its
--      quantity. A missing row means zero held, same "no row means zero"
--      contract homestead_tool and every sibling ledger here already use.
--   3. If the held quantity is short, return 'insufficient_material'.
--      Nothing has been mutated -- the FOR UPDATE lock is released when the
--      transaction ends, same as any read.
--   4. Spend Gold via spend_gold_by_profile (20260812120000) -- the same
--      row-locking primitive every other Gold spend in this app goes
--      through, never a second, parallel debit path. If it reports failure,
--      it has not mutated the balance (that is its own contract, relied on
--      identically by unlock_stackacres_perk above), so returning here is
--      still safe: nothing spent, nothing granted.
--   5. Only now, with both resources confirmed available and Gold already
--      spent, debit the material (guarded by `quantity >=` in the same
--      UPDATE as defense in depth, even though the FOR UPDATE lock from
--      step 2 already makes a concurrent short-read impossible) and grant
--      the enchantment. If either of these raises, the whole function's
--      transaction --  including the Gold debit from step 4 -- rolls back
--      with it: there is no state where Gold is spent and nothing is
--      forged.
create or replace function public.forge_stackacres_enchantment(
  p_profile_id uuid,
  p_item_id text,
  p_gold_cost integer,
  p_material_item text,
  p_material_quantity integer
)
returns table (
  success boolean,
  reason text,
  gold_balance integer,
  material_balance integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owned integer;
  v_material_held integer;
  v_spend record;
  v_material_remaining integer;
  v_gold_balance integer;
begin
  if p_gold_cost is null or p_gold_cost < 0 then
    raise exception 'Invalid enchantment Gold cost' using errcode = '22023';
  end if;
  if p_material_quantity is null or p_material_quantity <= 0 then
    raise exception 'Invalid enchantment material quantity' using errcode = '22023';
  end if;

  -- Step 1: already owned? Lock the row so a double-submit can't race past
  -- this check, but there is nothing to unlock -- a plain SELECT's row lock
  -- is released with the rest of the transaction either way.
  select quantity into v_owned
  from public.stackacres_tool_enchantments
  where profile_id = p_profile_id and item_id = p_item_id
  for update;

  if v_owned is not null and v_owned > 0 then
    select p.gold_balance into v_gold_balance from public.profiles as p where p.id = p_profile_id;
    select quantity into v_material_held
    from public.homestead_processing_inventory
    where profile_id = p_profile_id and item = p_material_item;
    return query select false, 'already_owned', v_gold_balance, coalesce(v_material_held, 0);
    return;
  end if;

  -- Step 2: lock and read the material row. No row means zero held.
  select quantity into v_material_held
  from public.homestead_processing_inventory
  where profile_id = p_profile_id and item = p_material_item
  for update;
  v_material_held := coalesce(v_material_held, 0);

  -- Step 3: refuse BEFORE spending anything if materials are short.
  if v_material_held < p_material_quantity then
    select p.gold_balance into v_gold_balance from public.profiles as p where p.id = p_profile_id;
    return query select false, 'insufficient_material', v_gold_balance, v_material_held;
    return;
  end if;

  -- Step 4: spend Gold. p_gold_cost = 0 is valid (a material-only
  -- enchantment) -- spend_gold_by_profile requires a positive amount, so a
  -- free-in-Gold forge reads the balance directly instead, the same
  -- carve-out unlock_stackacres_perk takes for a zero-cost perk.
  if p_gold_cost > 0 then
    select * into v_spend from public.spend_gold_by_profile(p_profile_id, p_gold_cost);
    if not v_spend.success then
      return query select false, 'insufficient_gold', v_spend.gold_balance, v_material_held;
      return;
    end if;
    v_gold_balance := v_spend.gold_balance;
  else
    select p.gold_balance into v_gold_balance from public.profiles as p where p.id = p_profile_id;
    if v_gold_balance is null then
      return query select false, 'no_such_profile', 0, v_material_held;
      return;
    end if;
  end if;

  -- Step 5: both resources confirmed and Gold already spent -- debit the
  -- material and grant the enchantment. A failure past this point rolls
  -- back the Gold debit above with it (same-transaction guarantee), so
  -- there is no way to observe Gold spent with nothing forged.
  update public.homestead_processing_inventory
     set quantity = quantity - p_material_quantity,
         updated_at = now()
   where profile_id = p_profile_id
     and item = p_material_item
     and quantity >= p_material_quantity
  returning quantity into v_material_remaining;

  if v_material_remaining is null then
    -- Cannot happen given the FOR UPDATE lock held since step 2 -- nothing
    -- else can have changed this row underneath us. Raised rather than
    -- silently treated as a lost race, so it surfaces loudly if that
    -- invariant is ever broken by a future edit (e.g. a lock scope change).
    raise exception 'material row changed under lock during forge_stackacres_enchantment'
      using errcode = '40001';
  end if;

  insert into public.stackacres_tool_enchantments as e (profile_id, item_id, quantity)
  values (p_profile_id, p_item_id, 1)
  on conflict (profile_id, item_id) do update set quantity = 1, updated_at = now();

  return query select true, 'forged', v_gold_balance, v_material_remaining;
end;
$$;

comment on function public.forge_stackacres_enchantment(uuid, text, integer, text, integer) is
  'Permanently buys one Sunlight Forge enchantment for Gold plus a processing-track material, verifying both resources under row locks before mutating either. Returns success=false with the current balances on already_owned/insufficient_material/insufficient_gold; null must never be treated as a purchase the way every sibling ledger RPC here already holds.';

-- `public` is load-bearing and not redundant -- anon and authenticated
-- inherit the default PUBLIC execute grant, so revoking from the two roles
-- alone leaves this callable on /rest/v1/rpc. This has shipped wrong twice
-- already on sibling StackAcres migrations (see
-- 20260901130000_revoke_homestead_function_execute_from_public.sql and
-- unlock_stackacres_perk's own comment) -- verify with proacl after
-- applying, not by re-reading this file.
revoke all on function public.forge_stackacres_enchantment(uuid, text, integer, text, integer)
  from public, anon, authenticated;
