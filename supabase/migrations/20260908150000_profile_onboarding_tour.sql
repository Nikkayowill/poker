-- Server-side flag for the spotlight onboarding tour (lobby + table steps).
-- A nullable timestamp rather than a boolean: lets a future v2 tour tell
-- "never seen" apart from "saw v1, before this date" instead of needing a
-- second column. Server-side (not localStorage, unlike the lobby's
-- FirstRunStrip) so it survives an installed PWA, which is a separate
-- storage context from the browser on iOS.

alter table public.profiles
  add column onboarding_tour_completed_at timestamptz;
