-- Covering index for cash_game_sessions.session_token's foreign key (flagged by the Supabase performance advisor).
create index if not exists cash_game_sessions_session_token_idx on public.cash_game_sessions (session_token);
