-- A cribbage table can now end on a forfeit with nobody winning: a seat
-- resigns or runs out its turn clock, loses its stake, and every other seat
-- gets its own stake back plus an equal share (lib/cribbage/engine.ts's
-- cribbagePayouts). Paying a resignation to the leader let two friends at a
-- three-seat table take a stranger's stake by having one of them quit.
--
-- So a completed table no longer always has a winner_id. A table that is
-- not completed still never has one.

alter table public.cribbage_tables
  drop constraint cribbage_tables_winner_matches_status;

alter table public.cribbage_tables
  add constraint cribbage_tables_winner_matches_status check (
    status = 'completed' or winner_id is null
  );

comment on column public.cribbage_tables.stake is
  'Gold ANTE PER SEAT, already debited from every seated player. On completion the pot (stake * seat count) is credited exactly once: all of it to winner_id, or, when winner_id is null because the table ended on a forfeit, refunded to the seats that did not forfeit plus an equal share of the forfeited stakes.';
