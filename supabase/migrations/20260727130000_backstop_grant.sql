-- Tracks the last "you're broke" top-up so it can be rate limited. Distinct
-- from last_daily_claim_at: the daily claim is a scheduled reward, this is a
-- recovery grant that only fires when a player cannot afford the cheapest
-- seat, so a player can legitimately receive both on the same day.
alter table public.profiles
  add column last_backstop_at timestamptz;

comment on column public.profiles.last_backstop_at is
  'Timestamp of the last broke-player recovery grant; rate limited independently of the daily claim.';
