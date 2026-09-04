-- Soil watering: the crop track gets its own tending loop.
--
-- Livestock has had one since the first migration (last_fed_at + a hunger
-- window that freezes ready_at until the animal is fed). Crops had nothing --
-- sow and walk away -- which is why the in-app copy still said "crops look
-- after themselves". This adds the exact mirror of that mechanic on the other
-- track: a crop's soil dries out `thirstMs` after its last watering (see
-- lib/stackacres/catalogue.ts), a dry crop stops progressing, and watering
-- pushes ready_at forward by however long it stood dry so neglected time is
-- never credited as work.
--
-- No new table, no new RPC, no new grant to get wrong: one nullable column on
-- homestead_units, written by the same version-guarded UPDATE path feeding
-- already uses (waterStackAcresUnit in lib/server/stackacres-store.ts).
--
-- NOTHING HERE MOVES MONEY. Watering is free -- it costs attention, not
-- Bushels and not Gold -- so this touches none of the ordering rules in
-- lib/server/stackacres-service.ts.

alter table public.homestead_units
  add column if not exists last_watered_at timestamptz;

comment on column public.homestead_units.last_watered_at is
  'Crops only; null for livestock, which is tended by feeding instead. Excluded time works the same way last_fed_at''s does: watering pushes ready_at forward by however long the soil stood dry, so a neglected crop genuinely stops progressing rather than the UI pretending it has. Null on a crop row means it predates this column and falls back to started_at -- sowing waters the ground.';

-- Backfill so the stored state says outright what the code would otherwise
-- infer. Crop rows only (livestock has no soil) and working rows only (a
-- mucked row is not growing and has nothing to freeze).
--
-- now(), NOT started_at, and this is the one judgement call in the file.
-- started_at is the honest answer to "when was this last watered" -- sowing
-- waters the ground -- but applying it here charges every existing crop for
-- neglecting a chore that did not exist while they were neglecting it. Worse,
-- it is not a small charge: thirstMs is under durationMs for both crop kinds,
-- so `started_at + thirst` always precedes ready_at, which means the
-- ripened-before-the-drought carve-out in isStackAcresUnitDry cannot protect a
-- single legacy row. Every crop already ripe and waiting to be collected would
-- flip to `dry` at deploy, stop being collectable, and un-ripen itself the
-- moment its owner tapped Water. Checked against the live table while writing
-- this: all seven working crop rows were already ripe, so that is 100% of the
-- real data, not an edge case.
--
-- The cost of now() is one free thirst window per in-flight crop, once, at
-- deploy. That is the cheaper side of the trade by a wide margin.
update public.homestead_units
   set last_watered_at = now()
 where stock in ('sprout', 'cash_crop')
   and status = 'working'
   and last_watered_at is null;

-- No trigger change. homestead_units_stock_shape is BEFORE INSERT only (see
-- 20260903180000's own note on why), and this column is written exclusively by
-- UPDATEs, so watering can never be blocked by the cap/ceiling guard -- the
-- same reason feeding never is.
