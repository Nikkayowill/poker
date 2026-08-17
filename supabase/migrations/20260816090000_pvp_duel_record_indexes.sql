-- Two partial indexes so a friend's head-to-head duel record can be read
-- straight off pvp_matches rather than maintained in a separate counter.
--
-- A maintained counter needs an atomic increment RPC and can drift from the
-- rows that actually settled; a derived read over pvp_matches itself cannot,
-- because there is nothing to keep in sync -- pvp_matches already is the
-- durable truth. The two indexes exist so that read stays cheap: one player
-- can appear as either player0_id or player1_id, so a lookup needs both
-- sides covered the same way friendships.profile_a/profile_b already are in
-- getFriendsOverview.

create index if not exists pvp_matches_player0_settled_idx
  on public.pvp_matches (player0_id, settled_at desc)
  where status = 'settled';

create index if not exists pvp_matches_player1_settled_idx
  on public.pvp_matches (player1_id, settled_at desc)
  where status = 'settled';
