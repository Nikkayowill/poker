-- Per-player IANA timezone, captured client-side from Intl.DateTimeFormat().
-- Nullable: most existing rows won't have one until the browser reports it.
-- Feeds the re-engagement push cron so it can send at a sensible local hour
-- instead of one fixed UTC time for everyone; nothing else reads it yet.
alter table public.profiles
  add column timezone text;
