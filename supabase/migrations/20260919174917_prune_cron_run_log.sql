-- pg_cron keeps a row in cron.job_run_details for every run and never cleans up.
-- kill-runaway-game-backends runs every minute, so that log had grown to ~44.6k rows
-- (7.9 MB), bigger than every app table except game_actions. Keep a week for debugging
-- and prune the rest nightly.

delete from cron.job_run_details where end_time < now() - interval '7 days';

select cron.schedule(
  'prune-cron-run-log',
  '30 4 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days';$$
);
