-- Ray's soil shelf: bags of each tier the player owns but has not laid down yet.
--
-- WHY A STOCK AT ALL, when placement used to just charge Gold. Ray's supply
-- store sells things; a soil bed is placed at a specific map tile, and a shop
-- shelf has no tile to name. Splitting it -- buy bags at the barn, lay them
-- where you like -- is what lets soil live on the same shelf as Feed and the
-- tool ladder. It also makes the two halves independently correct: the shop
-- moves Gold and never touches the map, and placement moves the map and never
-- touches Gold.
--
-- ITS OWN TABLE AND RPC, not `homestead_inventory` and not
-- `adjust_homestead_inventory`. Both of those exist and are the INERT barn-era
-- pair (see lib/server/stackacres-store.ts's own note); reusing either name
-- would silently point this feature at a dead table. Not
-- `homestead_processing_inventory` either: that space is typed to
-- `MachineItemId` and everything in it is contract-redeemable for Gold, which
-- a bag of dirt is deliberately not.
--
-- SHAPED AFTER `adjust_homestead_processing_inventory` on purpose, including
-- the `quantity >= 0` CHECK and the "raises 23514 rather than going negative"
-- contract. The CHECK is safe here for the reason it is safe there and NOT on
-- homestead_units: rows in this table are only ever inserted or incremented by
-- this one function, and a row that would go negative must fail loudly -- that
-- failure IS the "you have none left" answer placement depends on. There is no
-- settlement UPDATE on this table that a CHECK could strand.

create table public.homestead_soil_stock (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  tier text not null check (tier in ('dirt', 'enriched', 'hydro')),
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, tier)
);

comment on table public.homestead_soil_stock is
  'Unplaced soil bags per tier (SOIL_TIERS in lib/stackacres/soil-tiers.ts). Bought from Ray''s supply store, spent by place-soil-tile. Service-role only. Not homestead_inventory (inert, barn-era) and not homestead_processing_inventory (contract-redeemable for Gold; a soil bag is not).';

alter table public.homestead_soil_stock enable row level security;
revoke all on public.homestead_soil_stock from anon, authenticated;

create or replace function public.adjust_homestead_soil_stock(
  p_profile_id uuid,
  p_tier text,
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
  insert into public.homestead_soil_stock as st (profile_id, tier, quantity)
  values (p_profile_id, p_tier, greatest(p_delta, 0))
  on conflict (profile_id, tier) do update
    set quantity = st.quantity + p_delta,
        updated_at = now()
  returning st.quantity into next_quantity;

  return next_quantity;
end;
$$;

comment on function public.adjust_homestead_soil_stock(uuid, text, integer) is
  'Moves one player''s bag count for one soil tier atomically. Raises 23514 (from quantity''s own check) rather than going negative; the caller reads that as "none in stock" or a lost race, the same contract adjust_homestead_processing_inventory carries.';

-- `public` is load-bearing, not redundant: omitting it leaves the function
-- anonymously callable through PostgREST, which has shipped twice here before
-- being caught.
revoke execute on function public.adjust_homestead_soil_stock(uuid, text, integer)
  from public, anon, authenticated;
