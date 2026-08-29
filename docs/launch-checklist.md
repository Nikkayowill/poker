# StackChips launch checklist

This checklist prepares StackChips for a small invite-only beta.
Complete every item in this checklist before the beta starts.
StackChips does not support real-money wagering.

## Deployment

1. Push the reviewed working tree to the repository's `main` branch.
2. Import the repository into a Node.js-compatible Next.js host such as Vercel.
3. Configure all three production environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Never expose `SUPABASE_SERVICE_ROLE_KEY` through a `NEXT_PUBLIC_` variable.
5. Verify every migration in `supabase/migrations` is in the production Supabase migration ledger.
   Deploy only after this verification passes.
6. Open `/api/health` on the deployed domain.
   Do not invite players until this endpoint returns Hypertext Transfer Protocol (HTTP) status 200 with `"status":"ok"` and `"persistence":"supabase"`.

## Supabase controls

- Keep Row Level Security (RLS) enabled on every application table.
- Verify browser roles can select only from `public.game_signals`.
- Keep `persist_game_action` executable by `service_role` only.
- Keep only `public.game_signals` in the `supabase_realtime` publication.
- Enable Secure Sockets Layer (SSL) enforcement for every Supabase organization owner.
- Enable multi-factor authentication (MFA) for every Supabase organization owner.
- Use a paid Supabase plan, or verify the project will not pause during the invite window.
- Review the Security Advisor before each wider release.
- Review the Performance Advisor before each wider release.

## Support payments

StackChips sells no in-app purchases.
A support payment moves real money through Stripe.
This payment grants nothing in the game.
The `support_disclosure` entry in `lib/legal/documents.ts` states this rule.
Configure this support payment with care.

- Configure `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the six live support Price environment variables (`STRIPE_PRICE_SUPPORT_{SUPPORTER,BACKER,PATRON}_{ONCE,MONTHLY}`).
  See `.env.example` for the full list.
- Register one live webhook endpoint at `/api/stripe/webhook`.
  Subscribe this endpoint to these events:
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`
- Enable the Stripe Customer Portal (Dashboard → Settings → Billing → Customer portal).
  Allow immediate cancellation in this portal.
  No support tier unlocks anything in the game.
  A "hold until period end" setting protects nothing here.
  Immediate cancellation is fine.
- Verify both support-payment migrations are in the production migration ledger.
  Use `supabase migration list --linked` to check the ledger.
  Do this before you enable the support panel.
  See "Deploy / migration checklist" in CLAUDE.md.

## Gold purchases

Gold purchases use real money through the same Stripe integration.
The team reinstated Gold purchases after an accepted risk.
See the `gold_disclosure` entry in `lib/legal/documents.ts`.
See also the "Gold purchase reinstated" entry in CLAUDE.md.
The risk mitigation blocks Washington State billing addresses at checkout.
The function `enforceGoldBillingRestriction` in `lib/server/stripe.ts` performs this block.
This block is not a full geoblock.
Verify this block works before you enable the storefront:

- Attempt checkout with a Washington billing address in Stripe test mode.
- Verify Stripe refuses this checkout.

Other steps for this section:

- Configure the Gold-purchase Price environment variables alongside the support environment variables.
  See `.env.example`.
- Verify the Gold-purchase migrations are in the production migration ledger before you enable the storefront.
  Follow the same check as the support-payment migrations above.

## Push notifications

This section is optional.
The push feature stays off until its keys are present.
Follow this section only if you plan to enable push notifications for this deploy.

- Generate a real Voluntary Application Server Identification (VAPID) key pair.
  Configure this key pair.
  Push notifications need this key pair to work.
- Verify the `push_subscriptions` migration is in the production migration ledger.
- The daily re-engagement cron job fires at one fixed Coordinated Universal Time (UTC) hour.
  This cron job does not adjust for each player's own time zone.
  This is a known limit, not a bug.
  Expect an off-hours notification during testing.

## Staked games

This section covers Sit & Go, Cribbage, PvP duels, and Ante Up wagers.
Every staked surface other than poker cash tables follows the same money-ordering rules.
CLAUDE.md restates these rules at the top of the file.
The rules are:

- Debit the stake before creation.
- Credit the stake only after a version-guarded settlement.
- Credit the stake once.
- Release escrow once.

Check the items below before you invite players to any of these surfaces.

- Verify every migration each surface needs is in the production migration ledger.
  These migrations include:
  - `sit_and_go_tables` and `sit_and_go_table_players`
  - `cribbage_tables` and `cribbage_table_players`
  - `pvp_challenges` and `pvp_matches`
  - `ante_up_attempts`

  Merging a pull request (PR) that adds a table ships code only.
  Merging never ships the schema.
  Query the live project directly for this verification.
  See `[[reference_stackchips_migrations_not_auto_applied]]` for this verification style.
  Do not trust a changelog entry for this check.
- A `NOT VALID` CHECK constraint does not protect in-flight rows.
  This type of constraint has shipped broken twice against a real Postgres database.
  Each time, every memory-mode test passed.
  Verify a new CHECK constraint against a real Postgres transaction.
  Use a self-rolling-back `DO` block for this test.
  Do not rely on the local test suite alone.
- Ante Up wagers have a per-wager ceiling.
  Ante Up wagers also have retuned payouts (2026-08-26, PR #183).
  The team added both after a real farming incident.
  Verify the server enforces the ceiling before you treat a new Ante Up game as launch-ready.
- Host a Sit & Go tournament with a second profile.
  Bust one seat in this tournament.
  Verify the eliminated seat does not go to a bot.
  Verify the table removes the eliminated seat from its registrant list.
- Resign from a Cribbage table mid-hand with a second profile.
  Verify the table ends immediately.
  Verify the pot goes to the higher score.
  Verify the table does not continue with the remaining seats.

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

Then verify these steps in separate browser profiles:

1. Host a private room.
2. Copy the invite link.
3. Join the private room from a second profile.
4. Verify both players see the same turn.
5. Verify opponents' hole cards stay hidden before showdown.
6. Use a time card.
7. Verify the server adds 20 seconds for this time card.
8. Verify the server uses one time card.
9. Let a paid action time out.
10. Verify the server folds the player.
11. Raise into the bots.
12. Verify the game paces bot decisions visibly.
13. Give up a seat.
14. Verify a bot takes control of the seat.
15. Verify the bot does not stall the hand.
16. Upload a valid avatar.
17. Remove the valid avatar.
18. Switch a player offline during the player's turn.
19. Verify the game controls lock.
20. Verify the controls unlock only after the game receives the newest server snapshot.
21. Verify the installed app shell opens while offline.
22. Verify the app shell shows the reconnect state.
23. Verify the app shell does not allow stale gameplay.
24. In Stripe test mode, complete a one-time support payment.
25. In Stripe test mode, complete a monthly support signup.
26. Verify the support panel shows the active membership.
27. Verify the "Manage membership" button opens the Stripe Customer Portal.
28. Verify neither payment changed the test profile's Gold balance.
29. In Stripe test mode, complete a Gold purchase.
30. Verify the Gold balance increases by exactly the purchased amount.
31. Verify the Gold balance increases only once.
32. Play a Sit & Go tournament to completion with a second browser profile.
33. Play a Cribbage table to completion with a second browser profile.
34. Play one PvP duel to completion with a second browser profile.
35. Play one Ante Up wager to completion with a second browser profile.
36. Verify each game settles Gold exactly once.
37. Verify each game appears correctly on its leaderboard or head-to-head record.

## Operating envelope

The application rate limiter works locally on each process.
This setup is acceptable for a small, trusted beta.
A public or promoted launch needs a shared edge or Redis rate limiter.
A public or promoted launch also needs load testing before it opens registration broadly.

Session identity uses real Supabase Auth.
Supabase Auth supports email and password sign-in through `signInWithEmail` and `signUpWithEmail` in `components/poker-app.tsx`.
Supabase Auth also supports Google OAuth through `app/auth/callback/route.ts`.
Both sign-in methods link to the same profile across devices, using `lib/server/link-account.ts`.
A guest player still gets an HttpOnly random-cookie session.
This session keeps seats across page refreshes and duplicate tabs on one browser profile.
This session has no cross-device recovery unless the guest links an account.

### Timed-action guarantees

- `GET /api/games/[id]` is read-only.
  A Realtime invalidation never produces another database write.
  A Realtime invalidation never produces another invalidation.
- Supabase-backed games do not poll.
  Each seated browser schedules one request at the persisted deadline.
  The browser retries a transient failure at most three times.
- Each Next.js process coalesces requests for the same game version.
  Across processes, the database version compare-and-swap allows one commit.
- An expected timed-action loser returns `false`.
  This loser does not emit SQLSTATE `40001`.
  This loser does not create a Postgres error log.
- Every committed version produces one action-ledger row.
  Every committed version produces one upserted `game_signals` row.

These bounds link database work to the number of active tables and committed actions.
These bounds do not link database work to the browser refresh rate.

### Observation gate

After you deploy a gameplay or persistence change, keep the release invite-only.
Run a live session of 15 minutes with multiple browsers.
Keep the release invite-only until this session meets all the conditions below:

- The session produces no new `Concurrent game update` Postgres errors.
- Database central processing unit (CPU) usage stays below 60%, except during brief spikes.
- Active database connections stay below 70% of the configured maximum.
- Gameplay Application Programming Interface (API) 5xx responses stay below 1%.
- The 95th-percentile (p95) snapshot and action latency stays below 500 ms.

The current filtered Postgres Changes channel sends only one small signal row per table, by design.
Before the count of concurrent Realtime subscribers nears 3,000, migrate this invalidation fan-out to Realtime Broadcast.
Load-test Realtime Broadcast after this migration.
Supabase recommends Realtime Broadcast at that scale.
