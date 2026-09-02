-- Fixes a live bug: every stock attempt has been failing in production since
-- 20260901180000_homestead_inventory.sql landed.
--
-- That migration made `payout` inert -- collections yield produce (via the
-- new `yield_quantity` column), not Gold -- and re-pointed the stocking
-- trigger's ceiling at yield_quantity accordingly. It re-pointed the trigger
-- but missed the CHECK constraint from the original migration,
-- homestead_plots_stock_matches_status, which still requires `payout is not
-- null` for a working plot. Nothing has written `payout` since that day
-- (lib/server/homestead-store.ts's stockHomesteadPlot only ever set
-- yield_quantity), so every stocking UPDATE has set status = 'working' with
-- payout still null and the CHECK has rejected it outright -- caught here by
-- a real attempt in production, not by the memory-mode test suite (which
-- never exercises a real SQL CHECK). No Gold or Bushels were at risk:
-- stockHomestead's catch block already refunds the seed cost when the
-- database throws.
--
-- The fix: swap the invariant's dependency from the now-inert payout column
-- to the column that actually gets set, yield_quantity. Same shape otherwise.
alter table public.homestead_plots
  drop constraint homestead_plots_stock_matches_status;

alter table public.homestead_plots
  add constraint homestead_plots_stock_matches_status check (
    (status = 'working') = (
      stock is not null and stake is not null and yield_quantity is not null
      and started_at is not null and ready_at is not null
    )
  );

comment on constraint homestead_plots_stock_matches_status on public.homestead_plots is
  'A working plot has its full stocked shape; payout is checked no longer -- it has been inert since 20260901180000_homestead_inventory.sql, superseded by yield_quantity.';
