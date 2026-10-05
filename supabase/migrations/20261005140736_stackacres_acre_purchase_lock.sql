/* -------------------------------------------------------------------- */
/* Acre purchases are serialised per farm                                 */
/* -------------------------------------------------------------------- */

-- An acre's price rises with the acres a farm already owns, and
-- buyStackAcresAcre reads that count before it charges. Two buys sent at once
-- both read the same count and both paid the lower price. This writes the
-- acre under a per-farm lock and refuses it when the count no longer matches
-- the one the price was worked out from. The caller refunds on anything but
-- 'added'.
create or replace function public.add_homestead_acre(
  p_profile_id uuid,
  p_acre_id text,
  p_expected_owned integer
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform pg_advisory_xact_lock(hashtext('homestead_acres:' || p_profile_id::text));

  if exists (
    select 1 from public.homestead_acres where profile_id = p_profile_id and acre_id = p_acre_id
  ) then
    return 'owned';
  end if;

  if (select count(*) from public.homestead_acres where profile_id = p_profile_id) <> p_expected_owned then
    return 'stale';
  end if;

  insert into public.homestead_acres (profile_id, acre_id, source)
  values (p_profile_id, p_acre_id, 'bought');

  return 'added';
end;
$$;

revoke all on function public.add_homestead_acre(uuid, text, integer) from public, anon, authenticated;
