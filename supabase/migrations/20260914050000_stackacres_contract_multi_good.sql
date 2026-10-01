-- Multi-good Town Contracts: a rung may now ask for more than one processed
-- good at once (see lib/stackacres/contracts.ts's own header on
-- ContractDef.extraRequirements). Purely additive -- every contract row
-- written before this migration, and every single-good rung drawn after it,
-- simply has extra_requirements = null and behaves exactly as before.

alter table public.homestead_contracts
  add column extra_requirements jsonb;

comment on column public.homestead_contracts.extra_requirements is
  'Optional array of {"item","quantity"} objects: goods required ALONGSIDE the primary (item, quantity) pair on this same row, for a genuinely multi-good rung. Null for every contract before 2026-09-14 and every single-good rung since -- see lib/stackacres/contracts.ts''s own header. Parsed defensively by lib/server/stackacres-store.ts''s parseExtraRequirements, never trusted raw. Service-role only, same as the rest of this table.';
