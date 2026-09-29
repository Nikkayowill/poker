-- The Midnight Merchant is gone. He was built for the isometric world, and in
-- the top-down farm he only ever flickered into view for about a second after
-- every action (an absent-to-absent snapshot fell through to the "departing"
-- animation), sold three trinkets nothing in the game reads, and could only
-- appear at all behind a crit the starting trowel rolls at 0%.
--
-- All three tables were empty in production when this was written, so nothing
-- is being thrown away. The code went with it; see the PR.

drop function if exists public.redeem_midnight_merchant_item(uuid, text, integer);
drop function if exists public.expire_midnight_merchant_visit(uuid);
drop function if exists public.spawn_midnight_merchant(uuid, text, integer, jsonb);
drop function if exists public.get_midnight_merchant_stock(uuid);
drop function if exists public.get_midnight_merchant_state(uuid, integer);

drop table if exists public.stackacres_midnight_merchant_ledger;
drop table if exists public.stackacres_midnight_merchant_stock;
drop table if exists public.stackacres_midnight_merchant_state;
