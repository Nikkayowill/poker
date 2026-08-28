# StackChips

A free-to-play mobile arcade at `stackchips.app` — Texas Hold'em is the
flagship table, but the app is a whole floor of games built around one
server-authoritative engine and one shared Gold economy.

A Next.js/React/Supabase app where **the server is the only authority**.
Every game, staked or not, follows the same shape: the browser sends
intents, a rules engine in `lib/` owns all outcomes, and Supabase Realtime
only signals that something changed so clients refetch a filtered snapshot.
It is immediately playable with server-controlled bots and falls back to an
in-memory store when Supabase credentials are absent.

## What's on the floor

- **Texas Hold'em** — six-max cash tables, Heads-Up 1v1 duels, and Sit & Go
  tournaments (6-max, human-only, winner-take-all, escalating blinds).
- **Cribbage** — a 3-4 player free-for-all table, human-only.
- **Blackjack** — dealt by the house (Loki and Finn).
- **PvP duels** — Chess, Checkers, Trivia Showdown, and Word Race. Winner
  takes the pot, no rake; either player can wager any amount at or above the
  duel floor.
- **Ante Up** — Word Stack and Connections (a shared daily puzzle, one gated
  attempt/day), plus Sudoku, Memory Match, and Minesweeper (unlimited
  wager-or-free replay). More brain games are still being added.

Every staked game moves Gold, StackChips' only currency — never real money
directly, and no game here is decided by house odds; it's always skill,
performance against a challenge, or another player.

## Progression and identity

Players collect a roster of illustrated seat-art characters (bought, earned,
or unlocked by rank) that double as their avatar everywhere — profile photo,
store, and how they're drawn at a seated opponent's own seat. Missions and
achievements credit Gold automatically as you play; most PvP games (and
poker separately) keep a leaderboard and a per-friend head-to-head record.
Gold can be topped up for free (a daily grant with a streak multiplier,
rewarded ads, a one-time backstop claim) or purchased with real money;
voluntary one-time/monthly support payments are also available and grant no
gameplay advantage.

## Run it

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. With no environment values the server uses an
in-memory store, which is useful for local evaluation and still keeps all
game logic off the client.

To test from an iPhone or another device on the same Wi-Fi network, run
`npm run dev:network`, then open `http://YOUR-COMPUTER-LAN-IP:3000` on the
phone. Allow port 3000 through the computer firewall. PWA installation is not
required for browser play; service workers are intentionally disabled during
development.

For persistent Supabase mode:

1. Create a Supabase project.
2. Run every SQL file in `supabase/migrations` in filename order.
3. Copy `.env.example` to `.env.local` and provide the project URL,
   publishable/anon key, and service-role key. Other values there (Stripe,
   Web Push, Turnstile, Adsterra, admin/cron secrets) are optional — each
   feature they gate simply stays off until its keys are present.
4. Restart the Next.js server.

Never expose `SUPABASE_SERVICE_ROLE_KEY` (or any other server-only secret in
`.env.example`) as a `NEXT_PUBLIC_` value.

## Security and game model

- The browser sends only intents (fold/check/call/raise, a board move, a
  puzzle guess, a challenge/accept) — never a game outcome.
- Each game's rules engine (`lib/game/`, `lib/pvp/`, `lib/cribbage/`,
  `lib/arcade/`) owns randomness, validation, state transitions, and
  payouts. For poker specifically that's the shuffle, deck, hole cards,
  betting validation, street transitions, bot decisions, seven-card
  evaluation, side pots, and payouts.
- API snapshots strip anything the requesting player shouldn't see (deck,
  opponents' hole cards pre-showdown, etc.).
- Private game state is protected by RLS with no client read policy.
- Supabase Realtime publishes only a safe version signal; clients refetch a
  player-filtered snapshot from the API.
- State, balances, an audit action, and the realtime signal commit together
  in one optimistic, atomic database transaction.
- Every staked action follows the same money-ordering rules: debit before
  the thing it pays for exists (a failed creation refunds), credit only
  after a version-guarded settlement write is confirmed, settlement is
  always a single credit, and escrow releases exactly once.
- Every action is retained in an append-only audit ledger.

## Verification

```bash
npm test
npm run lint
npm run build
```

`npm run test:e2e` (Playwright) covers flows and UI that unit tests can't —
use it when changing a game's rules or layout. The engine test suite covers
hand ranking, wheel straights, card redaction, repeated complete hands, and
chip conservation, plus each other game's own rules and money-ordering
invariants.
