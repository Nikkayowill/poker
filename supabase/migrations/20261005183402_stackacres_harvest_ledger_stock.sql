/* -------------------------------------------------------------------- */
/* The harvest ledger takes every stock the farm grows                    */
/* -------------------------------------------------------------------- */

-- 20261002194253 rebuilt this check from the old pre-crop names, so every
-- crop harvest's telemetry row was refused (stackacres.harvest_ledger_failed,
-- 133 times by 2026-10-04) and the economy dashboard only saw animals. Same
-- list as homestead_units_stock_check. lib/server/stackacres-stock-sql.test.ts
-- keeps both in step with lib/stackacres/catalogue.ts.
alter table public.homestead_harvests drop constraint homestead_harvests_stock_check;
alter table public.homestead_harvests add constraint homestead_harvests_stock_check check (stock = any (array[
  'onion', 'potato', 'carrot', 'cabbage', 'pepper', 'tomato', 'corn', 'eggplant', 'bell_pepper', 'broccoli',
  'celery', 'green_bean', 'lettuce', 'radish', 'spinach', 'wheat',
  'hen', 'pig', 'cattle', 'hog', 'steer'
]));
