-- Admin-only moderation fields. Neither is exposed through any player-facing
-- API response (see lib/server/profile-store.ts's AdminProfileSummary) --
-- only the /api/admin/* surface reads them.
alter table public.profiles
  add column banned boolean not null default false,
  add column last_seen_ip text;
