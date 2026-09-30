-- Rank tiers replace levels.
--
-- Rank is now one of eight named tiers, Bronze to GOAT, placed by rank points
-- (lib/progression/rank.ts). Nothing is stored for the tier itself; it is read
-- off the points, so this migration only moves the three places that still
-- spoke in levels.
--
--  * player_progression.max_level_rewarded held the highest level whose Gold was
--    paid. It now holds the highest tier number paid (Bronze 1 .. GOAT 8). The
--    column and claim_rank_milestones keep their names so the function and any
--    in-flight deploy stay valid; only the meaning changes. Existing marks are
--    mapped down from the old level onto the tier that level sat in, so no
--    player is paid a tier they were already paid through.
--  * The three level achievements keep their codes, so nobody loses one they
--    unlocked, and become tier achievements.
--  * The weekly "Rank up" mission counted levels gained, which a tier ladder
--    makes far too rare for a week. It counts rank points earned instead.
--
-- Ship the code first, then apply this. With the old code still running, a mark
-- of 6 against a player at level 50 would pay every milestone up to 50 again.

-- Old level -> tier number. The old title bands were 1, 5, 12, 22, 35, 50, 70, 90.
update public.player_progression
set max_level_rewarded = case
  when max_level_rewarded >= 90 then 8
  when max_level_rewarded >= 70 then 7
  when max_level_rewarded >= 50 then 6
  when max_level_rewarded >= 35 then 5
  when max_level_rewarded >= 22 then 4
  when max_level_rewarded >= 12 then 3
  when max_level_rewarded >= 5 then 2
  else 1
end
where max_level_rewarded > 1;

comment on column public.player_progression.max_level_rewarded is
  'The highest rank tier number whose Gold has been paid (1 Bronze .. 8 GOAT). The name predates tiers. Only ever moves up, so a rank that falls and climbs back pays nothing twice.';

update public.achievement_definitions
set metric = 'rank_tier', threshold = 2, title = 'On The Board', description = 'Reach Silver tier.'
where code = 'level_10';
update public.achievement_definitions
set metric = 'rank_tier', threshold = 4, title = 'Made Man', description = 'Reach Emerald tier.'
where code = 'level_25';
update public.achievement_definitions
set metric = 'rank_tier', threshold = 6, title = 'Legend Of The Room', description = 'Reach Master tier.'
where code = 'level_50';

update public.mission_definitions
set metric = 'rank_points_gained',
    target = 100,
    title = 'Climb the ranks',
    description = 'Earn 100 rank points this week.'
where code = 'weekly_level_up';
