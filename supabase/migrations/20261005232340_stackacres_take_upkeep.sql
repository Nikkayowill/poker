/* -------------------------------------------------------------------- */
/* Today's land fee is taken atomically                                   */
/* -------------------------------------------------------------------- */

-- Sales skimmed the fee from a paid total read beforehand and then raised the
-- row to a target, so overlapping sales each kept their own cut while the row
-- only recorded the highest. This adds to the paid total under a row lock,
-- never past the fee, and returns what it took. The caller pays out the rest.
create or replace function public.take_homestead_upkeep(
  p_profile_id uuid,
  p_day date,
  p_fee integer,
  p_amount integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid integer;
  v_take integer;
begin
  if p_fee <= 0 or p_amount <= 0 then
    return 0;
  end if;

  insert into public.homestead_upkeep (profile_id, day, bushels)
  values (p_profile_id, p_day, 0)
  on conflict (profile_id, day) do nothing;

  select bushels into v_paid
  from public.homestead_upkeep
  where profile_id = p_profile_id and day = p_day
  for update;

  v_take := least(p_amount, greatest(0, p_fee - v_paid));
  if v_take > 0 then
    update public.homestead_upkeep
       set bushels = bushels + v_take, updated_at = now()
     where profile_id = p_profile_id and day = p_day;
  end if;
  return v_take;
end;
$$;

revoke all on function public.take_homestead_upkeep(uuid, date, integer, integer) from public, anon, authenticated;
