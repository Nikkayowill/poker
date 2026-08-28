-- Verified receipts for the native app's AdMob rewarded-video offer.
--
-- Counterpart to rewarded_ad_grants.sql for the surface where the gap that
-- migration's own comment describes doesn't exist: AdMob's rewarded-video
-- product ships server-side verification (SSV), a genuine server-to-server
-- signal Google's own infrastructure signs. This table is the idempotency
-- ledger for that signal, not a ticket the way rewarded_ad_grants is -- there
-- is no earlier "issued" row to flip, because the "issue" and "verify" steps
-- both happen on Google's side before this server ever sees the callback.
--
-- Two constraints carry the safety argument, same reasoning as
-- rewarded_ad_grants.sql:
--
--   1. admob_ssv_receipts_transaction_id_key -- one credit per Google
--      transaction_id, ever. Google redelivers a non-2xx SSV callback the
--      same way Stripe redelivers a webhook; a redelivery must find this row
--      already occupied and do nothing, never credit a second time.
--   2. reward_gold is stored on the row, not re-read from the code at read
--      time, for the same reason rewarded_ad_grants.reward_gold is: a
--      receipt records what it was actually paid even if the constant
--      changes later.
--
-- Same posture as every table since the M15 archives: service-role only.
-- Nothing here is granted to anon/authenticated; browsers only ever see what
-- app/api/profile/gold/admob-status returns, and even that is a read-only
-- "has my nonce landed yet" lookup, never a write.

create table public.admob_ssv_receipts (
  transaction_id text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- What this specific view was actually paid. See rule 2 above.
  reward_gold integer not null check (reward_gold > 0),
  -- The nonce the native client generated before showing the ad (AdMob's
  -- ssv.customData, round-tripped verbatim). Lets the client poll for its
  -- own callback landing without any other identifier to key on -- there is
  -- no client-visible id until Google mints transaction_id itself.
  custom_data text,
  -- The application clock at the moment this server verified the callback,
  -- written explicitly rather than defaulted to now() for the same reason
  -- rewarded_ad_grants.issued_at is: the daily-cap count and the client poll
  -- both compare against this, and mixing this server's clock with
  -- Postgres's own now() in the same comparisons is exactly the kind of
  -- skew that quietly shifts a UTC-day boundary.
  verified_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table public.admob_ssv_receipts is
  'One row per verified AdMob SSV callback. transaction_id is the payout idempotency key; custom_data lets the native client poll for its own reward landing.';

-- The daily-cap count and the client's own status poll both filter by
-- profile_id and a verified_at floor; custom_data is looked up alongside
-- profile_id for the poll, so it rides on the same index rather than a
-- second one.
create index admob_ssv_receipts_profile_verified_idx
  on public.admob_ssv_receipts(profile_id, verified_at desc);

alter table public.admob_ssv_receipts enable row level security;
revoke all on public.admob_ssv_receipts from anon, authenticated;
