/* -------------------------------------------------------------------- */
/* Sauerkraut is food                                                     */
/* -------------------------------------------------------------------- */

-- lib/stackacres/energy.ts made Sauerkraut food on 2026-10-02 but this
-- function's own list was never updated, so eating it raised 22023 in prod.
-- Same function as 20260918184033_stackacres_chapter6_feasts.sql with
-- 'sauerkraut' added. lib/server/stackacres-food-sql.test.ts keeps the two lists matched.
create or replace function public.eat_homestead_food(
  p_profile_id uuid,
  p_item text,
  p_expected_version bigint,
  p_level integer,
  p_updated_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left integer;
  v_rows integer;
begin
  if p_item not in ('bread', 'cake', 'stew', 'salad', 'salsa', 'sauerkraut', 'stuffed_peppers', 'bean_casserole', 'harvest_feast') then
    raise exception 'eat_homestead_food: % is not food', p_item using errcode = '22023';
  end if;

  update public.homestead_processing_inventory
     set quantity = quantity - 1,
         updated_at = now()
   where profile_id = p_profile_id
     and item = p_item
     and quantity >= 1
  returning quantity into v_left;

  if v_left is null then
    return 'no-food';
  end if;

  if p_expected_version = 0 then
    insert into public.homestead_energy (profile_id, level, updated_at, version)
    values (p_profile_id, p_level, p_updated_at, 1)
    on conflict (profile_id) do nothing;
  else
    update public.homestead_energy
       set level = p_level,
           updated_at = p_updated_at,
           version = version + 1
     where profile_id = p_profile_id
       and version = p_expected_version;
  end if;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'eat_homestead_food: energy moved on' using errcode = '40001';
  end if;

  return 'eaten';
end;
$$;

comment on function public.eat_homestead_food(uuid, text, bigint, integer, timestamptz) is
  'Eats one Bread, Cake, Stew, Salad, Salsa, Sauerkraut, Stuffed Peppers, Bean Casserole or Harvest Feast: debits it and writes the energy anchor in one transaction. Raises 40001 when the energy row is not at p_expected_version. See eatStackAcresFoodAction in lib/server/stackacres-service.ts.';

revoke all on function public.eat_homestead_food(uuid, text, bigint, integer, timestamptz)
  from public, anon, authenticated;
