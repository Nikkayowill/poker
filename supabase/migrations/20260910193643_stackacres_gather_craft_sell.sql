-- StackAcres: harvest always fills inventory, Gold moves through Sell.
--
-- A harvest used to pay Gold directly (harvest_stackacres), with Land
-- Maintenance netted out of that payout and a Bountiful Harvest synergy
-- multiplying it. Both are gone: a harvest now always credits the shared
-- processing inventory, for every item, not only milk/wool. Two things
-- follow:
--
--   1. THE ITEM SPACE WIDENS to every StackAcresItem (eggs, wool, milk, all
--      22 crops) plus Cake, the new multi-ingredient recipe. `milk`/`wool`
--      already lived here from the divert-era item-space overlap; this just
--      makes that overlap total rather than partial, since there is no more
--      Gold-track harvest for anything to divert AWAY from.
--
--   2. A NEW RPC, `process_homestead_recipe_multi`, generalizes
--      `process_homestead_recipe` (20260904170000) to more than one input --
--      Cake needs Eggs, Milk AND Flour in one atomic batch. The single-input
--      function is left in place, unused by new code but not dropped, per
--      this repo's append-only migration convention.
--
-- Gold now moves through exactly one produce-side door, `sell_stackacres_item`
-- (lib/server/stackacres-service.ts's `sellStackAcresItem`), which reuses
-- `adjust_homestead_processing_inventory` (debit) and
-- `reserve_homestead_exchange` (the same flat daily ceiling a harvest used to
-- reserve against) verbatim -- no new SQL needed for that half.

/* -------------------------------------------------------------------- */
/* 1. The item space: every StackAcresItem, plus Cake                    */
/* -------------------------------------------------------------------- */

alter table public.homestead_processing_inventory
  drop constraint homestead_processing_inventory_item_check;

alter table public.homestead_processing_inventory
  add constraint homestead_processing_inventory_item_check
  check (item in (
    'wheat', 'flour', 'milk', 'wool', 'cheese', 'cloth', 'cake',
    'eggs',
    'garlic', 'onion', 'beet', 'poppy', 'potato', 'carrot', 'cabbage',
    'cucumber', 'pepper', 'brokoly', 'sunflower', 'sunflowe_broken', 'wheat1', 'tomato',
    'corn', 'corn2', 'eggplant', 'grap', 'grap2', 'pumpkin', 'wheat2', 'artichoke'
  ));

comment on table public.homestead_processing_inventory is
  'Item quantities for lib/stackacres/machine-items.ts''s MachineItemId -- the whole inventory space now, since a harvest always credits here instead of paying Gold directly. The only door back to Gold is sell_stackacres_item or a fulfilled homestead_contracts row. Service-role only.';

/* -------------------------------------------------------------------- */
/* 2. Multi-input recipes (Cake: Eggs + Milk + Flour)                     */
/* -------------------------------------------------------------------- */

create or replace function public.process_homestead_recipe_multi(
  p_profile_id uuid,
  p_inputs jsonb,
  p_output_item text,
  p_output_quantity integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry jsonb;
  v_item text;
  v_quantity integer;
  v_remaining integer;
  v_output_total integer;
begin
  if p_output_quantity <= 0 then
    raise exception 'process_homestead_recipe_multi needs a positive output quantity'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs) = 0 then
    raise exception 'process_homestead_recipe_multi needs at least one input'
      using errcode = '22023';
  end if;

  -- Each input debited under its own row lock, one after another, all inside
  -- this one function's transaction -- so a shortfall on the second or third
  -- ingredient rolls back every debit that already ran in this call, the
  -- same all-or-nothing guarantee process_homestead_recipe's single debit
  -- already gives a one-input recipe.
  for v_entry in select * from jsonb_array_elements(p_inputs)
  loop
    v_item := v_entry->>'item';
    v_quantity := (v_entry->>'quantity')::integer;

    if v_item is null or v_quantity is null or v_quantity <= 0 then
      raise exception 'process_homestead_recipe_multi needs a positive quantity per input'
        using errcode = '22023';
    end if;
    if v_item = p_output_item then
      raise exception 'process_homestead_recipe_multi cannot convert an item into itself'
        using errcode = '22023';
    end if;

    update public.homestead_processing_inventory
       set quantity = quantity - v_quantity,
           updated_at = now()
     where profile_id = p_profile_id
       and item = v_item
       and quantity >= v_quantity
    returning quantity into v_remaining;

    -- Not enough on hand (or no row at all) for this input. Nothing beyond
    -- this point runs, and the debits already applied earlier in this same
    -- loop roll back with the rest of the transaction when the function
    -- returns null below -- there is no partial spend to compensate for.
    if v_remaining is null then
      return null;
    end if;
  end loop;

  insert into public.homestead_processing_inventory as inv (profile_id, item, quantity)
  values (p_profile_id, p_output_item, p_output_quantity)
  on conflict (profile_id, item) do update
    set quantity = inv.quantity + p_output_quantity,
        updated_at = now()
  returning inv.quantity into v_output_total;

  return v_output_total;
end;
$$;

comment on function public.process_homestead_recipe_multi(uuid, jsonb, text, integer) is
  'Runs one batch of a multi-input recipe atomically: debits every input under its own row lock, then credits the byproduct, all in one transaction. p_inputs is a jsonb array of {"item": text, "quantity": integer}. Returns the new byproduct quantity, or null when the player did not have enough of some input -- null must never be treated as a successful conversion. See processRecipe in lib/server/stackacres-service.ts.';

-- `public` is load-bearing and not redundant -- see release_homestead_exchange
-- (20260904150000)'s own comment on why omitting it is a silent no-op.
revoke execute on function public.process_homestead_recipe_multi(uuid, jsonb, text, integer)
  from public, anon, authenticated;

/* -------------------------------------------------------------------- */
/* 3. homestead_harvests.payout is a production ledger now                */
/* -------------------------------------------------------------------- */

comment on column public.homestead_harvests.payout is
  'A settled line''s nominal value at today''s sell price -- production, not Gold actually paid. A harvest credits inventory now, never Gold directly; this ledger only still feeds lib/stackacres/prestige.ts''s lifetime-gross eligibility check.';
