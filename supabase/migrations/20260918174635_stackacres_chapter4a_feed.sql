-- StackAcres Chapter 4a: feed crops and the first automation.
--
-- Adds the Feed Silo (an eighth machine kind, placed from the Workshop),
-- Cattle Feed as an inventory item the Mill makes from corn, and the Silo's
-- per-day auto-feed counter. Gold only moves through existing paths: placing
-- the Silo debits through spend_gold_by_profile like every other machine,
-- and Cattle Feed sells through sell_stackacres_item.

/* -------------------------------------------------------------------- */
/* 1. Machines: the Feed Silo, and a cap that grows with it              */
/* -------------------------------------------------------------------- */

alter table public.homestead_machines
  drop constraint homestead_machines_kind_check;

alter table public.homestead_machines
  add constraint homestead_machines_kind_check
  check (kind in ('mill', 'dairy', 'loom', 'vat', 'oven', 'stew_pot', 'counter', 'feed_silo'));

-- MACHINE_CAP grew 7 -> 8 with the Feed Silo (lib/stackacres/machines.ts),
-- still one of each kind. Kept in step with that constant by hand.
create or replace function public.homestead_machines_enforce_cap()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  existing integer;
begin
  perform pg_advisory_xact_lock(hashtext(new.profile_id::text || ':machines'));

  select count(*) into existing
  from public.homestead_machines
  where profile_id = new.profile_id;

  if existing >= 8 then
    raise exception 'StackAcres machine cap reached: % already placed', existing
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.homestead_machines_enforce_cap() is
  'Gates how many machines one player may place at once (8, one of each kind: mill, dairy, loom, vat, oven, stew_pot, counter, feed_silo). Fires only on insert.';

revoke execute on function public.homestead_machines_enforce_cap() from public, anon, authenticated;

-- A queued run writes its recipe onto the machine row. The Mill now has a
-- second queued recipe, so the list takes every recipe id there is.
alter table public.homestead_machines
  drop constraint if exists homestead_machines_recipe_id_check;

alter table public.homestead_machines
  add constraint homestead_machines_recipe_id_check
  check (recipe_id is null or recipe_id in (
    'flour', 'cheese', 'cloth', 'cake', 'bread', 'stew', 'salad', 'cattle_feed'
  ));

/* -------------------------------------------------------------------- */
/* 2. The item space: Cattle Feed                                        */
/* -------------------------------------------------------------------- */

-- Chapter 3's list plus Cattle Feed.
alter table public.homestead_processing_inventory
  drop constraint if exists homestead_processing_inventory_item_check;

alter table public.homestead_processing_inventory
  add constraint homestead_processing_inventory_item_check
  check (item in (
    'wheat', 'flour', 'milk', 'wool', 'cheese', 'cloth', 'cake', 'bread', 'stew', 'salad',
    'cattle_feed',
    'eggs',
    'garlic', 'onion', 'beet', 'poppy', 'potato', 'carrot', 'cabbage',
    'cucumber', 'pepper', 'brokoly', 'sunflower', 'sunflowe_broken', 'wheat1', 'tomato',
    'corn', 'corn2', 'eggplant', 'grap', 'grap2', 'pumpkin', 'wheat2', 'artichoke',
    'lettuce', 'spinach', 'radish', 'broccoli', 'bell_pepper', 'celery', 'green_bean',
    'wheatsheaf',
    'bluegill', 'trout', 'catfish',
    'meat', 'pelt'
  ));

/* -------------------------------------------------------------------- */
/* 3. The Silo's daily auto-feed counter                                 */
/* -------------------------------------------------------------------- */

-- Kept on the Silo's own machine row, so it is written under that row's
-- version guard and reaches the view through stackacres_read_batch, which
-- already returns whole machine rows. auto_feeds counts servings handed out
-- on auto_feed_day (a UTC day); a row from an earlier day counts as 0. The
-- 48 matches FEED_SILO_DAILY_FEEDS in lib/stackacres/feed-silo.ts, by hand.
alter table public.homestead_machines
  add column auto_feed_day date,
  add column auto_feeds integer not null default 0
    constraint homestead_machines_auto_feeds_check check (auto_feeds >= 0 and auto_feeds <= 48);

comment on column public.homestead_machines.auto_feeds is
  'Feed Silo only: servings auto-fed on auto_feed_day. Capped at 48 per UTC day. Written by writeStackAcresSiloFeeds in lib/server/stackacres-store.ts.';
