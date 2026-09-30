-- Ray's Museum, dropped: the barn no longer opens a donation museum (it
-- opens the supply store directly), so the tables and RPCs backing donations
-- and the secret wing have nothing left to write to them. Kayo's own call,
-- "delete this useless mechanic completely" -- see
-- 20260904120000_homestead_museum.sql and
-- 20260904190000_stackacres_museum_secrets.sql for what these were.
--
-- NOT DROPPED: achievement_definitions' 'museum_secrets_1' row
-- (20260904190100_museum_secrets_achievement.sql). It has no FK into either
-- table below, so nothing here cascades to it; leaving it in place preserves
-- any player who already earned it rather than deleting an award that was
-- already paid out. It simply becomes unearnable for anyone who has not --
-- the event that used to complete it no longer fires (lib/domain-events.ts's
-- `museum_secret_set_completed` kind was removed in the same pass).

drop function if exists public.mark_homestead_museum_donation(uuid, text);
drop function if exists public.mark_homestead_museum_secret(uuid, text);

drop table if exists public.homestead_museum_donations;
drop table if exists public.homestead_museum_secrets;
