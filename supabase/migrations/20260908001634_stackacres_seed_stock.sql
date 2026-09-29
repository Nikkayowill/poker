-- Ray's seed shelf: seeds of each crop the player owns but has not planted
-- yet.
--
-- WHY THIS EXISTS. The 22-crop roster (2026-09-07's CraftPix roster) broke
-- the seed ring: every crop was always plantable for a flat Gold price at
-- stocking time, so tapping empty ground in the Long Meadow offered all 22
-- at once with nowhere near enough room to lay them out. The fix is not a
-- bigger ring -- it is that a crop is no longer always plantable. Seeds are
-- bought from Ray for Gold, ahead of time, and only a crop the player is
-- actually carrying seed for shows up when they tap ground to plant it.
--
-- SHAPED AFTER `homestead_soil_stock` exactly, including the `quantity >= 0`
-- CHECK and the "raises 23514 rather than going negative" contract. Safe for
-- the same reason it is safe there: rows in this table are only ever
-- inserted or incremented by this one function, and there is no settlement
-- UPDATE elsewhere that a CHECK could strand.
--
-- LIVESTOCK IS NOT IN THIS TABLE. A Hen Coop/Sheep Pen/Cattle Pen is still
-- stocked straight for Gold, unchanged -- see SeedStock's own doc comment in
-- lib/stackacres/catalogue.ts. The `crop` CHECK below is the 22 crop ids
-- from STACKACRES_CROPS, not STACKACRES_STOCK.

create table public.homestead_seed_stock (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  crop text not null check (crop in (
    'garlic', 'onion', 'beet', 'poppy', 'potato', 'carrot', 'cabbage',
    'cucumber', 'pepper', 'brokoly', 'sunflower', 'sunflowe_broken', 'wheat1', 'tomato',
    'corn', 'corn2', 'eggplant', 'grap', 'grap2', 'pumpkin', 'wheat2', 'artichoke'
  )),
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, crop)
);

comment on table public.homestead_seed_stock is
  'Unplanted crop seeds per crop id (STACKACRES_CROPS in lib/stackacres/catalogue.ts). Bought from Ray''s supply store, spent by the stock action when planting that crop. Livestock is never in this table -- it stocks straight for Gold, unchanged. Service-role only.';

alter table public.homestead_seed_stock enable row level security;
revoke all on public.homestead_seed_stock from anon, authenticated;

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
  insert into public.homestead_seed_stock as st (profile_id, crop, quantity)
  values (p_profile_id, p_crop, greatest(p_delta, 0))
  on conflict (profile_id, crop) do update
    set quantity = st.quantity + p_delta,
        updated_at = now()
  returning st.quantity into next_quantity;

  return next_quantity;
end;
$$;

comment on function public.adjust_homestead_seed_stock(uuid, text, integer) is
  'Moves one player''s seed count for one crop atomically. Raises 23514 (from quantity''s own check) rather than going negative; the caller reads that as "none in stock" or a lost race, the same contract adjust_homestead_soil_stock carries.';

-- `public` is load-bearing, not redundant: omitting it leaves the function
-- anonymously callable through PostgREST, which has shipped twice here
-- before being caught.
revoke execute on function public.adjust_homestead_seed_stock(uuid, text, integer)
  from public, anon, authenticated;
