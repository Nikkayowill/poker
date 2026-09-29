-- StackAcres grass cutters a player has bought. The Scythe is free and has no
-- row, so this needs no backfill.
--
-- One row per bought cutter. The primary key is the settlement guard: the
-- service debits Gold first, then inserts with ON CONFLICT DO NOTHING, and a
-- second tap that writes nothing gets refunded.
create table public.homestead_cutter (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- Kept in step with STACKACRES_BUYABLE_CUTTERS in lib/stackacres/cutters.ts.
  cutter text not null check (cutter in ('mower')),
  bought_at timestamptz not null default now(),
  primary key (profile_id, cutter)
);

comment on table public.homestead_cutter is
  'StackAcres grass cutters a player has bought. No row means only the free Scythe. Service-role only.';

alter table public.homestead_cutter enable row level security;
revoke all on public.homestead_cutter from anon, authenticated;
