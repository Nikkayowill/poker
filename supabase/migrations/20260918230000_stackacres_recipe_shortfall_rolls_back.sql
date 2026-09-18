-- A multi-input recipe that ran short used to keep the inputs it had already
-- debited. The function did `return null` on a shortfall, and a normal return
-- commits every UPDATE that ran before it. Now a shortfall raises, which
-- rolls the whole call back, so nothing is spent unless the batch is made.
--
-- The error code is our own (SA001, "not enough input") rather than 23514, so
-- a real check violation (an item missing from a CHECK list, say) still
-- surfaces as an error instead of reading as "not enough".
--
-- seal_homestead_vat gets the same treatment. Its shortfall wrote nothing,
-- but a null composite comes back from PostgREST as an object of nulls, which
-- the caller could not tell from a real manifest.

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

    -- Raising (not returning) is what undoes the inputs debited earlier in
    -- this loop.
    if v_remaining is null then
      raise exception 'not enough %', v_item using errcode = 'SA001';
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
  'Runs one or more batches of a multi-input recipe atomically: debits every input under its own row lock, then credits the output, all in one transaction. p_inputs is a jsonb array of {"item": text, "quantity": integer}. Returns the new output quantity. Raises SA001 when some input is short, which rolls back every debit. See processRecipe and runFarmKitchen in lib/server/stackacres-service.ts.';

revoke execute on function public.process_homestead_recipe_multi(uuid, jsonb, text, integer)
  from public, anon, authenticated;

create or replace function public.seal_homestead_vat(
  p_profile_id uuid,
  p_machine_id uuid,
  p_item text,
  p_quantity integer,
  p_base_gold_value integer,
  p_sealed_at timestamptz,
  p_ready_at timestamptz
)
returns public.homestead_vat_manifests
language plpgsql
security definer
set search_path = public
as $$
declare
  input_remaining integer;
  manifest public.homestead_vat_manifests;
begin
  if p_quantity <= 0 then
    raise exception 'seal_homestead_vat needs a positive quantity'
      using errcode = '22023';
  end if;

  update public.homestead_processing_inventory
     set quantity = quantity - p_quantity,
         updated_at = now()
   where profile_id = p_profile_id
     and item = p_item
     and quantity >= p_quantity
  returning quantity into input_remaining;

  if input_remaining is null then
    raise exception 'not enough %', p_item using errcode = 'SA001';
  end if;

  -- A second seal of the same machine hits
  -- homestead_vat_manifests_one_per_machine (23505) and rolls the debit back.
  insert into public.homestead_vat_manifests
    (profile_id, machine_id, item, quantity, base_gold_value, sealed_at, ready_at, version)
  values
    (p_profile_id, p_machine_id, p_item, p_quantity, p_base_gold_value, p_sealed_at, p_ready_at, 1)
  returning * into manifest;

  return manifest;
end;
$$;

comment on function public.seal_homestead_vat(uuid, uuid, text, integer, integer, timestamptz, timestamptz) is
  'Debits the input and locks it inside an aging manifest (the Fermenting Vat or the Preserves Cellar), atomically. Returns the new manifest. Raises SA001 when the input is short and 23505 when the machine already holds a manifest; both roll back the debit.';

revoke execute on function public.seal_homestead_vat(uuid, uuid, text, integer, integer, timestamptz, timestamptz)
  from public, anon, authenticated;
