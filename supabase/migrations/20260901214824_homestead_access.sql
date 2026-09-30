-- Who may reach the StackChips Homestead while it is on the floor but not open.
--
-- Replaces the shared access code (HOMESTEAD_ACCESS_CODE, and before that an
-- allowlist of account ids in env). Both put the guest list in a deploy: one
-- env var, no way to let one person in and not another, and nothing in the app
-- that shows who is holding a pass. This is a per-profile flag toggled from the
-- admin dashboard, which is where every other per-player switch already lives.
--
-- Same shape as `banned` and `unlimited_gold` deliberately: one boolean on the
-- profile, default false, written only by the service role through
-- /api/admin/homestead-access. Default false means shipping this column admits
-- nobody, including whoever is reading it -- grant yourself in the dashboard.
alter table public.profiles
  add column if not exists homestead_access boolean not null default false;

comment on column public.profiles.homestead_access is
  'Admin-granted access to the Homestead while it is unreleased. See lib/server/homestead-access.ts.';
