-- Three accepted duel challenges pointed at pvp_matches rows that no longer
-- existed (deleted by hand, nothing in the app removes a match). A challenge
-- in that state can never be settled: reopenClaimedChallenge only touches a
-- null match_id, and the expiry sweep only touches open rows.
--
-- Close any such row without a refund, then make the link a real foreign key
-- so a match cannot be deleted underneath a challenge again. Default NO ACTION
-- is deliberate: a delete that would orphan a challenge should fail loudly
-- rather than quietly unlink it.

update public.pvp_challenges c
set status = 'cancelled', match_id = null
where c.match_id is not null
  and not exists (select 1 from public.pvp_matches m where m.id = c.match_id);

alter table public.pvp_challenges
  add constraint pvp_challenges_match_id_fkey
  foreign key (match_id) references public.pvp_matches(id);

create index if not exists pvp_challenges_match_id_idx
  on public.pvp_challenges(match_id)
  where match_id is not null;
