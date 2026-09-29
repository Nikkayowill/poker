-- Web Push subscriptions -- the re-engagement notification faucet.
--
-- One row per browser/device a player has granted notification permission
-- on, keyed by the endpoint the browser's push service assigned it (that
-- endpoint IS the subscription's identity -- a player who re-subscribes on
-- the same device gets a new endpoint from the browser, so there is no
-- other natural unique key). Service-role only, same reasoning as
-- ante_up_attempts: nothing here is ever read by the client directly, only
-- written by /api/push/subscribe and read by the cron sender.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  -- The two keys Web Push encryption needs, base64url as the browser hands
  -- them back from PushSubscription.toJSON() -- opaque to this app, passed
  -- straight through to web-push's sendNotification.
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  -- Set after a successful send so the daily cron can skip a subscription
  -- it already notified today, even on a re-run -- belt and suspenders
  -- alongside the cron's own "already claimed today" query.
  last_notified_at timestamptz
);

comment on table public.push_subscriptions is
  'A browser''s Web Push subscription for one profile. endpoint is the natural key -- a fresh subscribe from the same device replaces it via upsert-on-endpoint, not a duplicate row.';

-- The cron's whole query: every subscription for a registered profile that
-- has not been notified today, joined against profiles.last_daily_claim_at.
create index push_subscriptions_profile_idx
  on public.push_subscriptions(profile_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
