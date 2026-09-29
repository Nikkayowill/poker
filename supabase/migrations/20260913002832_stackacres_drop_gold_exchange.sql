-- StackAcres dropped its flat daily Gold ceiling entirely (2026-09-12, Kayo's
-- call) -- see lib/stackacres/exchange.ts's header for why. This table and
-- its two RPCs existed only to serve that ceiling (reserve/release against a
-- per-player daily allowance); nothing else in the schema references them.
-- Land Maintenance (homestead_upkeep) is untouched -- a separate mechanic
-- that never shared code or state with this one beyond a UTC-day helper.

drop function if exists public.release_homestead_exchange(uuid, date, integer);
drop function if exists public.reserve_homestead_exchange(uuid, date, integer, integer);
drop table if exists public.homestead_exchanges;
