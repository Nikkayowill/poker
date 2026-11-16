-- Who may open StackStrike while it is a private prototype.
--
-- A per-profile flag toggled from the admin dashboard, the same shape as
-- `homestead_access` and `admin_badge`: one boolean, default false, written
-- only by the service role through /api/admin/stackstrike-access. Default
-- false means nobody is let in until somebody is granted in the dashboard.
alter table public.profiles
  add column if not exists stackstrike_access boolean not null default false;

comment on column public.profiles.stackstrike_access is
  'Lets this player open the StackStrike prototype. See lib/server/profile-store.ts setStackStrikeAccess.';
