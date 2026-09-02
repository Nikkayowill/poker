-- Whose seat reads "Admin" at the poker table.
--
-- A per-profile flag toggled from the admin dashboard, the same shape as
-- `banned`, `unlimited_gold` and `homestead_access`: one boolean, default
-- false, written only by the service role through /api/admin/admin-badge.
-- It is a label and nothing else -- the admin portal's own access is a
-- signed cookie exchanged for ADMIN_SECRET (lib/server/admin-auth.ts) and
-- this column plays no part in that. Default false means nobody is tagged
-- until somebody is granted in the dashboard.
alter table public.profiles
  add column if not exists admin_badge boolean not null default false;

comment on column public.profiles.admin_badge is
  'Shows an "Admin" tag above this player''s poker seat. Cosmetic only; see lib/server/profile-store.ts setAdminBadge.';
