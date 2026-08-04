# StackChips

A free-to-play social poker game at `stackchips.app`.

A compact, server-authoritative no-limit Texas Hold’em game built with Next.js and
Supabase. It is immediately playable at a six-max table with server-controlled opponents and
uses Supabase persistence/realtime automatically when credentials are present.

Player profiles persist across tables and support display names, six built-in
avatars, six table colors, and personal PNG/JPEG/WebP/GIF uploads. Uploaded files
are validated by size and file signature on the server, then stored in the public
`avatars` Supabase Storage bucket.

The supplied video is **“Build a Planning Poker Game with Supabase”** by Angular
Love. StackChips applies its session + realtime update pattern to actual Texas
Hold’em; the poker rules and visual product are original to this project.

## Run it

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. With no environment values the server uses an
in-memory store, which is useful for local evaluation and still keeps all poker
logic off the client.

To test from an iPhone or another device on the same Wi-Fi network, run
`npm run dev:network`, then open `http://YOUR-COMPUTER-LAN-IP:3000` on the
phone. Allow port 3000 through the computer firewall. PWA installation is not
required for browser play; service workers are intentionally disabled during
development.

For persistent Supabase mode:

1. Create a Supabase project.
2. Run every SQL file in `supabase/migrations` in filename order.
3. Copy `.env.example` to `.env.local` and provide the project URL, anon key, and
   service-role key.
4. Restart the Next.js server.

Never expose `SUPABASE_SERVICE_ROLE_KEY` as a `NEXT_PUBLIC_` value.

## Security and game model

- The browser sends only intents: fold, check, call, raise, all-in, or next hand.
- The Node.js rules engine owns the shuffle, deck, hole cards, betting validation,
  street transitions, bot decisions, seven-card evaluation, side pots, and payouts.
- API snapshots strip the deck and redact every opponent card until showdown.
- `game_state_private` is protected by RLS and has no client read policy.
- Supabase Realtime publishes only a safe version signal; clients refetch a
  player-filtered snapshot from the API.
- `persist_game_action` commits state, seat balances, audit action, metadata, and
  the realtime signal in one optimistic, atomic database transaction.
- Every action is retained in an append-only audit ledger.

## Verification

```bash
npm test
npm run build
```

The engine tests cover hand ranking, wheel straights, card redaction, repeated
complete hands, and chip conservation.
