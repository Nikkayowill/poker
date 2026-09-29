-- The Crop Fields' own unlock -- what used to be clearing the `meadow`
-- sector (homestead_sectors, sector = 'meadow') before the 2026-09-08 map
-- restructure merged that district into the Farmstead outright. See
-- lib/stackacres/crop-fields.ts's own header for why the gate could not stay
-- a sector clear once that happened: the Farmstead is a HOME sector,
-- permanently unlocked, and a district cannot be both free to walk into and
-- gated behind 15,000 Gold at the same time.
--
-- SHAPED EXACTLY LIKE `homestead_greenhouse` (20260905130000): one row per
-- profile, written once, never updated, its primary key the whole
-- idempotency guard against two tabs unlocking together. Priced in Gold and
-- debited through the ordinary Gold ledger (spendGoldByProfile/refundGold in
-- lib/server/stackacres-service.ts), the same as `homestead_sectors` always
-- was -- unlike the Greenhouse, there is no second resource to lock
-- atomically, so no RPC is needed here.
--
-- `homestead_sectors`' own CHECK constraint on `sector` is left untouched:
-- 'meadow' stays a legal value there (widened most recently by
-- 20260907120000), and any existing row naming it becomes a harmless orphan
-- rather than something worth a destructive migration to clean up -- the
-- app simply never reads or writes that value again. See CLAUDE.md's own
-- caution on narrowing a CHECK constraint that existing rows may already
-- violate.

create table public.homestead_crop_fields (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  unlocked_at timestamptz not null default now()
);

comment on table public.homestead_crop_fields is
  'Whether a player has unlocked the Crop Fields (lib/stackacres/crop-fields.ts). One row per profile, permanent, never refunded -- same posture as homestead_greenhouse. Service-role only.';

alter table public.homestead_crop_fields enable row level security;
revoke all on public.homestead_crop_fields from anon, authenticated;
