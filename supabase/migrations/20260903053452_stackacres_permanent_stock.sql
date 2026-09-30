-- StackAcres: stock you buy outright with Gold, and land you buy in any order.
--
-- WHAT CHANGES, and why it is one small column rather than a new table.
--
-- Until now every animal and every crop was sown with Bushels and CONSUMED by
-- its own harvest: the plot emptied and you sowed it again. Gold bought
-- acreage and nothing else, so a player arriving with a season of poker
-- winnings could buy an empty field and then had to grind Sprout Rows to put
-- anything on it. The farm was the one place in the app where winning at the
-- tables bought you nothing.
--
-- A bought animal is the same row in the same table doing the same thing --
-- growing on a timer, getting hungry, being collected -- with exactly one
-- difference: it does not leave when you take what it made. So: one boolean.
--
--   permanent = false  the row as it has always been. Seed paid in Bushels,
--                      consumed at harvest, tile back to empty (or mucked).
--   permanent = true   bought outright for Gold. At collection the row keeps
--                      its stock, stake and yield and simply starts its next
--                      cycle; it never empties and never mucks.
--
-- NOT NULL DEFAULT false is deliberate and is what makes this safe to apply
-- to a live table: every existing row means "sown with Bushels", which is
-- exactly what every existing row is. There is no backfill to get wrong.
--
-- WHAT DOES NOT CHANGE, and the thing to check in review: the Gold ceiling.
-- `reserve_homestead_exchange` still holds a hard 5,000 per player per UTC
-- day and this migration does not touch it. Everything added here SPENDS
-- Gold. The honest consequence is that bought stock makes that existing
-- ceiling reliably reachable where it used to take constant attention -- but
-- nobody takes out a Gold more than they could yesterday.
--
-- Tables are still named homestead_* on purpose. The app renamed Homestead to
-- StackAcres in 20260902; the database deliberately did not follow, for the
-- same reason river_* cookies keep their name.

alter table public.homestead_plots
  add column if not exists permanent boolean not null default false;

comment on column public.homestead_plots.permanent is
  'True when this plot''s stock was bought outright with Gold (lib/stackacres/market.ts). A permanent plot re-sows itself at collection instead of emptying, and never mucks. False -- the default, and what every pre-existing row is -- means sown with Bushels and consumed by its own harvest.';

-- The harvest ledger needs the same flag, and this is not cosmetic.
--
-- `homestead_harvests.stake` records what the seed cost in Bushels, and the
-- economy dashboard reads it as "what this harvest cost to produce". A bought
-- plot pays no Bushels per cycle at all -- it was paid for once, in Gold --
-- so writing the catalogue's seed price there would systematically understate
-- how much the farm actually nets. The obvious fix is to write 0, and it is
-- not available: `stake` carries `check (stake > 0)` from the original
-- migration.
--
-- So the flag travels with the row instead, and a dashboard can subtract the
-- notional stake on bought plots rather than believing it. Same NOT NULL
-- DEFAULT false: every harvest recorded before today was a sown plot, which is
-- exactly what the default says.
alter table public.homestead_harvests
  add column if not exists permanent boolean not null default false;

comment on column public.homestead_harvests.permanent is
  'True when this harvest came off stock bought outright with Gold. Such a plot pays no Bushels per cycle, so its `stake` is the catalogue''s notional seed price rather than money actually spent -- do not count it as a cost without checking this flag.';

-- Deliberately NO check constraint tying `permanent` to `status`.
--
-- The obvious one would be `permanent implies status = 'working'`, and it
-- would be a trap for a reason this repo has now recorded twice: a CHECK
-- re-evaluates on every UPDATE, so a single row that ever fell out of shape
-- would become permanently unwritable and 500 that player's farm forever,
-- with no way to fix it from the app. The relationship is held by the store's
-- write paths instead (collectStackAcresPlot and retireStackAcresPlot are the
-- only two that move it), and a desync there costs a save state, not money --
-- the Gold was spent before the row was ever written.

-- The stocking trigger needs no change and is left exactly as it is. Worth
-- stating because it looks like it should: it fires `before insert or update
-- ... when (new.status = 'working')`, so a permanent plot restarting its cycle
-- DOES fire it, and that is correct. It counts this player's other working
-- plots (`id <> new.id`), so a restart sees the same count it saw when the
-- plot was first stocked and passes; a fourth pen still cannot be opened. The
-- yield ceiling likewise still applies, and bought stock yields exactly what
-- sown stock yields.

-- Land prices flattened to a single figure in the same pass
-- (STACKACRES_PLOT_PRICE), which is what lets plots be bought in ANY order.
-- No schema change is needed for that: `plot_index` was never ordered by the
-- database, only by the service, which walked the ladder purely so a cheap
-- tile could not be left unbought beneath a dear one. Flat prices retire that
-- rule; the unique index on (profile_id, plot_index) is still what stops a
-- plot being bought twice.
