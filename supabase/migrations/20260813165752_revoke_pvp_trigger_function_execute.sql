-- pvp_matches_enforce_one_active() is a BEFORE INSERT trigger function, only
-- ever meant to run as part of that trigger. It landed after the 2026-08-09
-- privilege hardening pass (20260809044511_harden_public_function_privileges.sql)
-- and picked up Postgres's default PUBLIC execute grant, which the Supabase
-- security advisor flags: it is directly callable via
-- /rest/v1/rpc/pvp_matches_enforce_one_active by anon and authenticated.
--
-- Calling it outside trigger context errors immediately (NEW is unassigned),
-- so this was never a working exploit path -- but it's an unnecessary grant
-- that breaks the "no client-callable RPC touches game/profile state"
-- invariant every other function here follows. Revoking EXECUTE doesn't
-- affect the trigger: Postgres invokes trigger functions directly, without
-- checking the firing role's EXECUTE privilege.
revoke execute on function public.pvp_matches_enforce_one_active() from public, anon, authenticated;

-- Defense-in-depth re-run of the 2026-08-09 blanket revoke, to catch this
-- function and anything else added since that slipped past the earlier pass.
revoke execute on all functions in schema public from public, anon, authenticated;
