-- The Homestead's new stone terrace wall covers map rows 31 to 35. Fence pieces
-- already standing there come down, and each one's 2 Wood goes back to its farm,
-- the same refund remove_homestead_fence gives.
with removed as (
  delete from public.homestead_fences
   where ty between 31 and 35
  returning profile_id
), refunds as (
  select profile_id, count(*) * 2 as wood
    from removed
   group by profile_id
)
insert into public.homestead_processing_inventory as inv (profile_id, item, quantity)
select profile_id, 'wood', wood from refunds
on conflict (profile_id, item) do update
  set quantity = inv.quantity + excluded.quantity,
      updated_at = now();
