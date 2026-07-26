-- Voluntary seat release, so a player who no longer wants to play hands
-- their seat back to bot control instead of leaving it permanently claimed.
-- Auto-fold/auto-check timeouts for idle turns reuse the existing 'fold' and
-- 'check' audit actions and need no schema change.

alter type public.action_type add value 'leave_seat';

comment on column public.game_seats.owner_token is
  'Session token of the human seated here; null means the seat is bot-controlled and open to be claimed or was voluntarily released via leave_seat.';
