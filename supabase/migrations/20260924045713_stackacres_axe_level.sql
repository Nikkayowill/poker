-- StackAcres' axe: which level of axe a player holds (lib/stackacres/axe.ts).
--
-- One row per player, created on the first upgrade. No row is the starting
-- level 1 axe, so this needs no backfill.
--
-- The upgrade is guarded in the service: it inserts from level 1 (the primary
-- key lets one insert win) or updates `where level = <the level it was seen
-- at>`, so a double tap pays once and the loser is refunded. No Gold moves in
-- SQL.
create table public.homestead_axe (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  -- Kept in step with AXE_LEVELS in lib/stackacres/axe.ts.
  level smallint not null default 1 check (level between 1 and 3),
  updated_at timestamptz not null default now()
);

comment on table public.homestead_axe is
  'Which level of axe a StackAcres player holds. No row means the starting level 1 axe. Service-role only.';

alter table public.homestead_axe enable row level security;
revoke all on public.homestead_axe from anon, authenticated;
