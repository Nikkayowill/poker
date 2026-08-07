-- Server-issued grants for the "watch an ad, claim Gold" offer.
--
-- The browser cannot be asked whether an ad played -- Adsterra's publisher
-- products carry no server-to-server completion postback, so there is no
-- signal to verify. What the server can own is when it made the offer and
-- whether it has already paid for it, and that is exactly what this table is:
-- a ticket with an issue time and a one-way status.
--
-- Three constraints carry the whole safety argument, and each one is here
-- rather than in the service because a rule enforced in application code is a
-- rule two concurrent requests can both pass:
--
--   1. rewarded_ad_grants_one_pending_per_profile -- one ad in flight at a
--      time. Without it a client scripts twenty starts, waits thirty seconds
--      once, and redeems twenty rewards for one wait.
--   2. status is only ever flipped by an UPDATE ... where status = 'pending',
--      which is the settlement idempotency key, the same contract
--      blackjack_rounds.version has. Only one caller's UPDATE can match, so a
--      double-clicked Claim pays once.
--   3. reward_gold is stored on the row, not read from the code at claim time.
--      A grant issued today pays what it was issued for even if the constant
--      changes before it is claimed.
--
-- The daily cap (lib/rewards/config.ts) is a count over claimed_at rather than
-- a column, so it moves with the constant and needs no backfill.
--
-- Same posture as every table since the M15 archives: service-role only.
-- Nothing here is granted to anon/authenticated, and browsers only ever see
-- what app/api/profile/gold/rewarded returns.

create table public.rewarded_ad_grants (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'claimed')),
  -- What this specific grant is worth. See rule 3 above.
  reward_gold integer not null check (reward_gold > 0),
  -- Written by the service from Node's clock, NOT defaulted to now(): the
  -- elapsed-time rule is a comparison against that same clock, and mixing two
  -- clocks in one inequality turns a 30-second wait into a 29-second one on a
  -- server whose Postgres is a moment ahead.
  issued_at timestamptz not null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  -- A claimed grant must carry the moment it was claimed: the daily cap counts
  -- these, so a null here would be a free reward that no cap can see.
  constraint rewarded_ad_grants_claimed_has_timestamp
    check ((status = 'claimed') = (claimed_at is not null))
);

comment on table public.rewarded_ad_grants is
  'Server-issued rewarded-ad tickets. issued_at is the clock the 30-second wait is measured against; the pending -> claimed flip is the payout idempotency key.';

comment on column public.rewarded_ad_grants.issued_at is
  'Written from the application clock, never defaulted, so the elapsed-time check compares two readings of the same clock.';

-- One ad in flight per player. Partial on status so the history accumulates
-- freely underneath it. Enforced here rather than by a check-then-insert,
-- because two concurrent starts both pass a read-first check.
create unique index rewarded_ad_grants_one_pending_per_profile
  on public.rewarded_ad_grants(profile_id)
  where status = 'pending';

-- The daily-cap count: claimed rows for one profile since midnight UTC.
create index rewarded_ad_grants_claimed_idx
  on public.rewarded_ad_grants(profile_id, claimed_at desc)
  where status = 'claimed';

alter table public.rewarded_ad_grants enable row level security;
revoke all on public.rewarded_ad_grants from anon, authenticated;
