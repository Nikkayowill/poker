/* -------------------------------------------------------------------- */
/* Spending seed, feed or a secret item you never held is refused         */
/* -------------------------------------------------------------------- */

-- These three inserted greatest(p_delta, 0) when the farm had no row yet, so
-- a spend of -1 on a crop or feed the player never held wrote a 0 and
-- reported success instead of raising 23514. In production that meant one
-- free seed of every crop (locked ones too) and one free feed serving per
-- farm, while memory mode refused. 20260920225058 fixed the same bug for
-- adjust_homestead_processing_inventory; this gives these three the same
-- guarded debit. lib/server/stackacres-adjust-sql.test.ts keeps them that way.

create or replace function public.adjust_homestead_seed_stock(
  p_profile_id uuid,
  p_crop text,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_quantity integer;
begin
  if p_delta < 0 then
    update public.homestead_seed_stock
       set quantity = quantity + p_delta,
           updated_at = now()
     where profile_id = p_profile_id
       and crop = p_crop
       and quantity >= -p_delta
    returning quantity into next_quantity;

    if next_quantity is null then
      raise exception 'not enough % seed on hand', p_crop
        using errcode = 'check_violation';
    end if;

    return next_quantity;
  end if;

  insert into public.homestead_seed_stock as st (profile_id, crop, quantity)
  values (p_profile_id, p_crop, p_delta)
  on conflict (profile_id, crop) do update
    set quantity = st.quantity + p_delta,
        updated_at = now()
  returning st.quantity into next_quantity;

  return next_quantity;
end;
$$;

revoke all on function public.adjust_homestead_seed_stock(uuid, text, integer) from public, anon, authenticated;

create or replace function public.adjust_homestead_feed(
  p_profile_id uuid,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_servings integer;
begin
  if p_delta < 0 then
    update public.homestead_feed
       set servings = servings + p_delta,
           updated_at = now()
     where profile_id = p_profile_id
       and servings >= -p_delta
    returning servings into next_servings;

    if next_servings is null then
      raise exception 'not enough feed on hand'
        using errcode = 'check_violation';
    end if;

    return next_servings;
  end if;

  insert into public.homestead_feed as f (profile_id, servings)
  values (p_profile_id, p_delta)
  on conflict (profile_id) do update
    set servings = f.servings + p_delta,
        updated_at = now()
  returning f.servings into next_servings;

  return next_servings;
end;
$$;

revoke all on function public.adjust_homestead_feed(uuid, integer) from public, anon, authenticated;

create or replace function public.adjust_homestead_secret_ledger(
  p_profile_id uuid,
  p_item_id text,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_quantity integer;
begin
  if p_delta < 0 then
    update public.homestead_secret_ledger
       set quantity = quantity + p_delta,
           updated_at = now()
     where profile_id = p_profile_id
       and item_id = p_item_id
       and quantity >= -p_delta
    returning quantity into next_quantity;

    if next_quantity is null then
      raise exception 'not enough % on hand', p_item_id
        using errcode = 'check_violation';
    end if;

    return next_quantity;
  end if;

  insert into public.homestead_secret_ledger as l (profile_id, item_id, quantity)
  values (p_profile_id, p_item_id, p_delta)
  on conflict (profile_id, item_id) do update
    set quantity = l.quantity + p_delta,
        updated_at = now()
  returning l.quantity into next_quantity;

  return next_quantity;
end;
$$;

revoke all on function public.adjust_homestead_secret_ledger(uuid, text, integer) from public, anon, authenticated;
