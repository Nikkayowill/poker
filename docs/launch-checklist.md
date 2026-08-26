# StackChips launch checklist

StackChips is suitable for a small invite-only beta once every item below is
complete. It is not intended for real-money wagering.

## Deployment

1. Push the reviewed working tree to the repository's `main` branch.
2. Import the repository into a Node.js-compatible Next.js host such as Vercel.
3. Configure all three production environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Never expose `SUPABASE_SERVICE_ROLE_KEY` through a `NEXT_PUBLIC_` variable.
5. Deploy only after every migration in `supabase/migrations` is present in the
   production Supabase migration ledger.
6. Open `/api/health` on the deployed domain. Do not invite players unless it
   returns HTTP 200 with `"status":"ok"` and `"persistence":"supabase"`.

## Supabase project controls

- Keep RLS enabled on every application table.
- Confirm browser roles can only select from `public.game_signals`.
- Keep `persist_game_action` executable by `service_role` only.
- Keep only `public.game_signals` in the `supabase_realtime` publication.
- Enable SSL enforcement and MFA for every Supabase organization owner.
- Use a paid plan or confirm the project will not pause during the invite window.
- Review Security Advisor and Performance Advisor before each wider release.

## Stripe support payments

StackChips takes no in-app purchases. This is real money moving through Stripe for a support payment
that grants nothing in-game (`lib/legal/documents.ts`'s `support_disclosure`) — configure it deliberately.

- Configure `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the six live support Price env vars
  (`STRIPE_PRICE_SUPPORT_{SUPPORTER,BACKER,PATRON}_{ONCE,MONTHLY}`) — see `.env.example`.
- Register one live webhook endpoint at `/api/stripe/webhook` subscribed to: `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`,
  `invoice.payment_failed`.
- Enable the Stripe Customer Portal (Dashboard → Settings → Billing → Customer portal) and allow
  cancellation. No support tier unlocks anything in-game, so there is nothing a "hold until period
  end" configuration would be protecting — immediate cancellation is fine.
- Confirm both support-payment migrations are on the production migration ledger (`supabase migration
  list --linked`) before enabling the support panel — see "Deploy / migration checklist" in CLAUDE.md.

## Release verification

Run:

```bash
npm ci
npm test
npm run test:e2e
npm run lint
npm run build
npm start
```

Then verify in separate browser profiles:

1. Host a private room and copy its invite link.
2. Join from a second profile and confirm both players see the same turn.
3. Confirm opponents' hole cards remain hidden before showdown.
4. Use a time card and confirm the server adds 20 seconds and consumes one card.
5. Let a paid action time out and confirm the server folds the player.
6. Raise into the bots and confirm their decisions are visibly paced.
7. Give up a seat and confirm a bot takes control without stalling the hand.
8. Upload and remove a valid avatar.
9. Switch a player offline during their turn and confirm controls lock until
   the newest server snapshot is received.
10. Confirm the installed app shell opens offline and shows the reconnect
    state rather than allowing stale gameplay.
11. In Stripe test mode, complete a one-time support payment and a monthly
    signup; confirm the support panel shows the active membership and
    "Manage membership" opens the Stripe Customer Portal. Confirm neither
    payment changed the test profile's Gold balance.

## Current operating envelope

The application rate limiter is process-local. That is acceptable for a small,
trusted beta, but a public or promoted launch should add a shared edge/Redis
limiter and load testing before opening registration broadly.

Session identity is real Supabase Auth: email/password (`signInWithEmail`/
`signUpWithEmail` in `components/poker-app.tsx`) and Google OAuth
(`app/auth/callback/route.ts`), both linking to the same profile across
devices via `lib/server/link-account.ts`. A guest still gets an HttpOnly
random-cookie session that preserves seats across refreshes/duplicate tabs on
one browser profile, but has no cross-device recovery unless they link an
account.

### Timed-action load guarantees

- `GET /api/games/[id]` is read-only. A Realtime invalidation can never produce
  another database write or another invalidation.
- Supabase-backed games do not poll. Each seated browser schedules one request
  at the persisted deadline; transient failures receive at most three retries.
- Requests for the same game version are coalesced inside each Next.js process.
  Across processes, the database version compare-and-swap permits one commit.
- An expected timed-action loser returns `false`; it does not emit SQLSTATE
  `40001` or create a Postgres error log.
- Every committed version produces one action-ledger row and one upserted
  `game_signals` row.

These bounds make database work proportional to active tables and committed
actions, rather than browser refresh frequency.

### Production observation gate

After deploying a gameplay or persistence change, keep the release invite-only
until a 15-minute live session with multiple browsers satisfies all of these:

- no new `Concurrent game update` Postgres errors;
- database CPU remains below 60% outside brief spikes;
- active database connections remain below 70% of the configured maximum;
- gameplay API 5xx responses remain below 1%;
- p95 snapshot and action latency remains below 500 ms.

The current filtered Postgres Changes channel is intentionally limited to one
small signal row per table. Before approaching roughly 3,000 concurrent
Realtime subscribers, migrate this invalidation fan-out to Realtime Broadcast
and load-test it; Supabase recommends Broadcast for that scale.
