-- Enriched Substrate and Hydro Soil are gone: a soil bag is one product, dirt.
-- Both tier CHECKs are narrowed to match SOIL_TIERS in
-- lib/stackacres/soil-tiers.ts.
--
-- NO DATA IS CONVERTED. Production held only 'dirt' rows in both tables when
-- this was written (Ray's shelf stopped selling the other two before this
-- change). If a row of either retired tier exists by the time this runs, the
-- ADD CONSTRAINT below fails loudly rather than quietly rewriting what a
-- player owns.
--
-- BOTH CHECKS ARE SAFE, for the reason the originals were: homestead_soil_tiles
-- and homestead_soil_stock are insert-and-increment only, so there is no
-- settlement UPDATE for a CHECK to strand (contrast homestead_units).
--
-- ORDER: ships with the code that stops reading the two tiers. The old code
-- tolerates the narrower CHECK because it never writes either tier any more.

alter table public.homestead_soil_tiles
  drop constraint if exists homestead_soil_tiles_tier_check;
alter table public.homestead_soil_tiles
  add constraint homestead_soil_tiles_tier_check check (tier in ('dirt'));

comment on column public.homestead_soil_tiles.tier is
  'What the bed is made of. Only dirt exists today; the column stays so a second tier is a code change, not a schema one. Mirrors SOIL_TIERS in lib/stackacres/soil-tiers.ts. Starter tiles are never stored in this table at all, so they are dirt by definition.';

do $$
declare
  cname text;
begin
  -- The stock CHECK was declared inline, so it carries a generated name.
  select conname into cname
  from pg_constraint
  where conrelid = 'public.homestead_soil_stock'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%enriched%';
  if cname is not null then
    execute format('alter table public.homestead_soil_stock drop constraint %I', cname);
  end if;
end
$$;

alter table public.homestead_soil_stock
  add constraint homestead_soil_stock_tier_check check (tier in ('dirt'));
