-- Both Homestead functions landed with Postgres's default PUBLIC execute grant
-- still in place. The migration that created them revoked EXECUTE "from anon,
-- authenticated" but not "from public", and anon/authenticated inherit the
-- PUBLIC grant, so the revoke was a no-op -- exactly the mistake
-- 20260813170000_revoke_pvp_trigger_function_execute.sql exists to fix. The
-- established idiom, from credit_gold onward, is "from public, anon,
-- authenticated" and all three names are load-bearing.
--
-- 20260831150000_homestead_plots.sql has since been corrected at its source, so
-- an environment building from scratch never opens this hole. This migration is
-- for the environment that already ran the flawed version, and is a harmless
-- no-op anywhere else.
--
-- adjust_homestead_feed is the one that mattered: SECURITY DEFINER, taking the
-- profile id as a parameter rather than reading it from the caller's session,
-- and it works when called directly. Exposed on /rest/v1/rpc it let any
-- anonymous caller move any player's feed balance by any amount -- feed is
-- bought with Gold, so that is a Gold-equivalent faucet, and a negative delta
-- empties a rival's supply. Nothing in the app has ever called it as anything
-- but service_role.
revoke execute on function public.adjust_homestead_feed(uuid, integer) from public, anon, authenticated;

-- homestead_plots_enforce_stock_shape is a BEFORE trigger function, and the
-- same reasoning as the pvp precedent applies: calling it outside trigger
-- context errors immediately (NEW is unassigned), so this was never a working
-- exploit path, but it breaks the "no client-callable RPC touches game or
-- profile state" invariant every other function here follows. Revoking EXECUTE
-- does not affect the trigger -- Postgres invokes trigger functions directly,
-- without checking the firing role's EXECUTE privilege.
revoke execute on function public.homestead_plots_enforce_stock_shape() from public, anon, authenticated;
