-- A town contract can be PASSED, at most once per UTC day.
--
-- WHY. The board is one slot and a contract cannot be cancelled (see
-- lib/stackacres/contracts.ts's header), so a rung the player does not want
-- sits there until they fill it. Drawing only from goods the farm can
-- actually make already removed the dead end -- a contract for a good with
-- no machine behind it -- but not the plain bad draw: eight Flour when you
-- wanted two, on a farm with one bed. A pass is the release valve.
--
-- WHY ONCE A DAY. Unlimited passes would turn the single slot into a
-- reroll button and the board into an arbitrage puzzle: spin until the
-- best-paying rung comes up, which is the exact game the one-open-contract
-- rule exists to prevent. One a day is a decision ("is this worth my pass?")
-- rather than a dice roll.
--
-- 'passed' is a THIRD terminal status, not a delete. The partial unique
-- index `homestead_contracts_one_open_per_profile` is `where status =
-- 'open'`, so a passed row frees the slot without any change to the index,
-- and the row stays as the record of when the pass was spent.
--
-- `resolved_at` is when a contract stopped being open, for either terminal
-- status. It is what the once-a-day rule reads (the most recent passed row's
-- UTC day), which `created_at` cannot answer: created_at is when the
-- contract was DRAWN, so a contract drawn yesterday and passed today would
-- read as yesterday's pass. Backfilled null on purpose -- every existing
-- fulfilled row predates the column and no rule looks at their resolution
-- time.
--
-- Widening a CHECK, never narrowing one: every row already in the table
-- satisfies the new list, so there is no validation pass to fail and no
-- in-flight UPDATE to block (the trap in the 2026-08 CHECK-constraint note).

alter table public.homestead_contracts
  drop constraint homestead_contracts_status_check;

alter table public.homestead_contracts
  add constraint homestead_contracts_status_check
  check (status in ('open', 'fulfilled', 'passed'));

alter table public.homestead_contracts
  add column if not exists resolved_at timestamptz;

comment on column public.homestead_contracts.resolved_at is
  'When this contract stopped being open, for either terminal status. The once-per-UTC-day pass rule reads the newest passed row''s value; see passStackAcresContract in lib/server/stackacres-service.ts.';

-- Answers "has this profile passed one today" in one index hit, without
-- scanning a player's whole contract history.
create index if not exists homestead_contracts_passed_idx
  on public.homestead_contracts (profile_id, resolved_at desc)
  where status = 'passed';
