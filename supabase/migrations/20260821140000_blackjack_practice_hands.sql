-- Blackjack practice hands: a $0 round with nothing at risk.
--
-- base_stake carried a "positive" check because until now every round staked
-- real Gold. Blackjack's practice mode (lib/server/blackjack-service.ts)
-- deals a genuine $0 round through the same table -- server-owned, same
-- version-guarded settlement -- so the constraint only needs to keep out a
-- negative stake, not a zero one. Migrations are append-only, so this loosens
-- the existing check rather than editing 20260805120000_blackjack_rounds.sql.

alter table public.blackjack_rounds
  drop constraint blackjack_rounds_base_stake_check;

alter table public.blackjack_rounds
  add constraint blackjack_rounds_base_stake_check check (base_stake >= 0);
