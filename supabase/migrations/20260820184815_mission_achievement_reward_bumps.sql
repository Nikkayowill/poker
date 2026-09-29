-- Grows Gold rewards from missions, achievements and level milestones --
-- play-driven income specifically, not the passive faucets (daily grant,
-- backstop, rewarded ads), so active play is what funds a climb up the
-- stakes ladder. Explicit per-code UPDATEs against the existing catalogs
-- rather than a re-run of the seed INSERTs, so this migration's diff is
-- exactly the numbers that changed.
--
-- lib/server/mission-store.ts and lib/server/achievement-store.ts's
-- DEFAULT_DEFINITIONS mirrors move in the same commit -- both must carry
-- the same numbers or memory-mode/tests drift from production, the same
-- duplication every memory-mode store here carries against its own table.
--
-- MILESTONE_GOLD (lib/progression/rank.ts, a pure TS constant, no table
-- behind it) also moves 500 -> 1500 in that same commit -- see rank.ts's
-- own comment and rank.test.ts's widened house-edge guard for why.

-- ---- missions: roughly 3x -------------------------------------------------

update public.mission_definitions set reward_gold = 450 where code = 'daily_play_hands';
update public.mission_definitions set reward_gold = 450 where code = 'daily_win_duels';
update public.mission_definitions set reward_gold = 300 where code = 'daily_brain_game';
update public.mission_definitions set reward_gold = 450 where code = 'daily_multiplayer';
update public.mission_definitions set reward_gold = 3000 where code = 'weekly_win_duels';
update public.mission_definitions set reward_gold = 3600 where code = 'weekly_active_days';
update public.mission_definitions set reward_gold = 4500 where code = 'weekly_cross_category';
update public.mission_definitions set reward_gold = 2400 where code = 'weekly_level_up';

-- ---- achievements: tier 1 unchanged (an onboarding-speed reward already),
-- tiers 2/3 roughly doubled ------------------------------------------------

update public.achievement_definitions set reward_gold = 3000 where code = 'hands_played_1000';
update public.achievement_definitions set reward_gold = 30000 where code = 'hands_played_10000';

update public.achievement_definitions set reward_gold = 3000 where code = 'hands_won_500';
update public.achievement_definitions set reward_gold = 30000 where code = 'hands_won_5000';

update public.achievement_definitions set reward_gold = 6000 where code = 'net_profit_100k';
update public.achievement_definitions set reward_gold = 50000 where code = 'net_profit_1m';

update public.achievement_definitions set reward_gold = 6000 where code = 'biggest_pot_50k';
update public.achievement_definitions set reward_gold = 50000 where code = 'biggest_pot_250k';

update public.achievement_definitions set reward_gold = 3000 where code = 'chips_won_1m';
update public.achievement_definitions set reward_gold = 30000 where code = 'chips_won_10m';

update public.achievement_definitions set reward_gold = 5000 where code = 'duels_won_50';
update public.achievement_definitions set reward_gold = 40000 where code = 'duels_won_250';

update public.achievement_definitions set reward_gold = 3000 where code = 'puzzles_completed_100';
update public.achievement_definitions set reward_gold = 24000 where code = 'puzzles_completed_500';

update public.achievement_definitions set reward_gold = 5000 where code = 'level_25';
update public.achievement_definitions set reward_gold = 40000 where code = 'level_50';
