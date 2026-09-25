-- Links a duel match back to the challenge it came from.
--
-- Accepting a challenge writes the match first and pvp_challenges.match_id
-- second. A process that dies between the two left an accepted challenge with
-- no match id, and nothing could tell whether a match existed for it. The
-- stranded-claim sweep in lib/server/pvp-match-service.ts reads this column to
-- decide: link the match if there is one, refund the challenger if there is
-- not.
--
-- Unique, so one challenge can never become two matches. Nullable because
-- matches from before this column have no link. Set null on delete for the
-- same reason pvp_challenges.match_id is a plain reference: a profile
-- deletion cascades through both tables and must not trip over the link.

alter table public.pvp_matches
  add column if not exists challenge_id uuid
    references public.pvp_challenges(id) on delete set null;

create unique index if not exists pvp_matches_challenge_id_idx
  on public.pvp_matches(challenge_id)
  where challenge_id is not null;
