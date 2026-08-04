-- Closes the default PUBLIC EXECUTE grant on archive_hand.
--
-- 20260803120000_hand_archives.sql revoked the function from anon and
-- authenticated but not from PUBLIC. Postgres grants EXECUTE on every new
-- function to PUBLIC by default, and both of those roles inherit it -- so the
-- original revoke removed a privilege they never held directly while leaving
-- the one they actually used in place. archive_hand writes hand archives with
-- caller-supplied hole cards, so a client able to call it could forge or
-- overwrite the record of a hand.
--
-- A new migration rather than an edit to 20260803120000: that file is already
-- applied, so changing it would alter deployed history and still not re-run.
--
-- Safe to re-run. REVOKE on an absent privilege is a no-op, so this is
-- correct whether or not the earlier migration has reached a given database.

revoke all on function public.archive_hand(
  uuid, integer, text, jsonb, integer, integer, jsonb, jsonb, boolean, integer, jsonb
) from public;

revoke all on function public.archive_hand(
  uuid, integer, text, jsonb, integer, integer, jsonb, jsonb, boolean, integer, jsonb
) from anon, authenticated;
