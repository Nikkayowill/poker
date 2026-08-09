# Production security actions for the owner

Audit date: 2026-08-09

Everything in this file requires production-account access or a business-risk
decision. Code changes and local developer work are intentionally omitted.

## Required before calling production hardened

- [ ] **Deploy this security changeset and apply migration
  `20260809044511_harden_public_function_privileges.sql`.** Confirm the
  production migration ledger includes every repository migration, especially
  friends/table invites, Gold RPCs, arcade rounds, rewarded grants,
  progression, and this privilege migration. The new migration removes public
  schema creation and ambient RPC execution; it protects nothing until it is
  applied to the live database.

- [ ] **Run Supabase's Security and Performance Advisors after the migration.**
  Resolve every high/critical finding, then run both advisors again. Confirm
  that browser roles can select only the intentionally public leaderboard and
  game-invalidation data, cannot execute server RPCs, and cannot read session
  tokens, private game state, cards, payments, wallets, friends, or invites.

- [ ] **Configure distributed rate limits in Vercel WAF.** Keep these at the
  edge so abusive traffic is rejected before a function starts and normal
  gameplay gets no database-limiter latency. Start with:

  - `/api/admin/session`: 8 requests per IP per 15 minutes
  - `/api/ai/chat`: 10 requests per IP per minute
  - `/api/stripe/checkout-session`: 5 requests per IP per minute
  - Gold claims, friend requests, and table invites: 10 requests per IP per
    minute
  - `/api/games/*/actions`: approximately 240 requests per IP per minute, with
    monitoring before lowering it

  Vercel overwrites its forwarding headers at the edge, so use Vercel's client
  IP/rate-limit fields rather than defining a rule around a custom header.
  Verify one limit from two simultaneous regions/instances.

- [ ] **Rotate `ADMIN_SECRET` in Vercel immediately after deployment.** Use at
  least 32 random bytes, redeploy, and sign in again through the admin session
  screen. Ordinary admin routes no longer accept the raw secret; rotation also
  invalidates every previously issued signed admin cookie.

- [ ] **Verify production secrets and webhook configuration.** Ensure
  `SUPABASE_SERVICE_ROLE_KEY`, Stripe secret/webhook keys, `ADMIN_SECRET`,
  `CRON_SECRET`, and `OPENROUTER_API_KEY` exist only in encrypted production
  environment settings—not preview builds, client-visible variables, logs, or
  team chat. In Stripe, confirm the live webhook points to
  `/api/stripe/webhook` and is subscribed only to the checkout events the app
  handles. Rotate any value whose handling history is uncertain.

## Production verification

- [ ] **Run an external post-deploy security smoke test.** Verify all of the
  following against `https://stackchips.app`:

  - another player cannot see hole cards, private state, hand history, wallet,
    friends, or invites
  - anonymous Data API clients cannot invoke Gold/game/admin RPCs
  - foreign-origin POST requests receive `403`
  - admin routes reject `x-admin-secret` and accept only the signed admin
    session cookie
  - gameplay/auth/admin responses are `private, no-store`
  - production session cookies use the `__Host-` prefix with `Secure`,
    `HttpOnly`, `SameSite=Lax`, `Path=/`, and no `Domain`
  - CSP, HSTS, frame denial, MIME-sniffing denial, COOP, and Permissions Policy
    headers are present

- [ ] **Enable alerts for abuse and money-path failures.** Alert on spikes in
  401/403/429/5xx responses, failed admin unlocks, Stripe signature failures,
  duplicate/failed fulfillment, abnormal Gold adjustments, and Supabase
  advisor regressions. Restrict Vercel, Supabase, Stripe, and Sentry team access
  to people who need it and require MFA for those accounts.

## Owner risk decision

- [ ] **Accept or remove the rewarded-ad supply-chain risk.** Production CSP
  still permits inline scripts and wildcard Adsterra script/connect origins.
  The iframe sandbox limits impact, but a third-party ad compromise remains a
  real risk. Either approve that tradeoff in writing and review the vendor
  periodically, or remove the ad integration before tightening CSP to nonces
  and fixed origins.
