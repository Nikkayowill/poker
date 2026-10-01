-- Fixes a stale check constraint found while shipping the Spinach Loaf
-- contract rung: homestead_contracts_item_check was last written in
-- 20260904170000 as check (item in ('flour', 'cheese', 'cloth')) and never
-- widened for 'cake' (added the same day machine-items.ts's
-- MACHINE_PROCESSED_ITEMS grew a fourth entry) or now 'spinach_loaf'
-- (20260914050000). Both are already legal ContractDef.item values in code
-- and CONTRACT_RUNGS -- against a real Supabase project, posting or
-- fulfilling either would have failed with a check_violation this whole
-- time. Caught only because this session's tests run against the in-memory
-- store, which enforces no such constraint.

alter table public.homestead_contracts
  drop constraint homestead_contracts_item_check;

alter table public.homestead_contracts
  add constraint homestead_contracts_item_check
  check (item in ('flour', 'cheese', 'cloth', 'cake', 'spinach_loaf'));
