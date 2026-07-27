-- Links a profile to a real authenticated account. Nullable by design: the
-- app's whole premise is that you can play instantly as a guest, so a profile
-- exists long before an account does, and the session cookie remains the
-- identity used for gameplay. This column only answers "whose account owns
-- this profile", which is what lets progress survive a cleared cookie.
--
-- Unique because an account owns exactly one profile: signing in on a second
-- device re-points that device's session cookie at the existing profile
-- rather than creating a parallel one.
--
-- ON DELETE SET NULL rather than CASCADE: deleting an auth account should
-- orphan the profile back to guest state, never destroy the player's Gold.
alter table public.profiles
  add column user_id uuid unique references auth.users(id) on delete set null;

comment on column public.profiles.user_id is
  'Owning auth account, or null for a guest profile that has never signed in.';
