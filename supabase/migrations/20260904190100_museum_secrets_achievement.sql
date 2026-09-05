-- Ray's Museum's hidden wing gets its own achievement: one tier, since
-- there is nothing to re-earn (the hidden set has exactly three pieces --
-- see lib/stackacres/museum-secrets.ts -- so "collected 1" and "collected
-- every one of them, ever" are the same fact). Mirrors DEFAULT_DEFINITIONS
-- in lib/server/achievement-store.ts exactly; keep the two in step by hand,
-- the same duplication every achievement/mission row here already carries.
--
-- `category` on achievement_definitions is a bare `text` with no CHECK
-- constraint (confirmed against 20260817120000's own DDL), so a new category
-- string needs no ALTER here.

insert into public.achievement_definitions
  (code, category, tier, source_kind, metric, threshold, reward_gold, reward_cosmetic_id, title, description, sort_order)
values
  ('museum_secrets_1', 'museum_secrets', 1, 'counter', 'museum_secrets_collected', 1, 2500, null, 'Ray''s Best Friend', 'Complete Ray''s hidden collection.', 91);
