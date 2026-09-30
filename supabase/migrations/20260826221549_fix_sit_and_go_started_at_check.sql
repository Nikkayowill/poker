-- sit_and_go_tables_started_at_matches_status required every non-'waiting'
-- row to have started_at set. That's true for 'active'/'completed', but not
-- for 'cancelled': leave_sit_and_go_table can cancel a table that never
-- dealt (empty-out pre-deal, started_at still null), same as
-- game_id_matches_status and prize_pool_matches_status both already carve
-- 'cancelled' out for -- this constraint just forgot to. Confirmed live:
-- the very first leave on a still-waiting table hard-failed this check.
-- Matches the other two constraints' shape exactly: 'cancelled' is
-- unconstrained here, since it can happen either pre-deal (null) or via
-- cancel_stale_sit_and_go_table post-deal (already set by that point).
alter table public.sit_and_go_tables
  drop constraint sit_and_go_tables_started_at_matches_status,
  add constraint sit_and_go_tables_started_at_matches_status
  check (
    (status = 'waiting' and started_at is null)
    or (status in ('active', 'completed') and started_at is not null)
    or status = 'cancelled'
  );
