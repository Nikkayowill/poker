# River Room launch checklist

River Room is suitable for a small invite-only beta once every item below is
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

## Current operating envelope

The application rate limiter is process-local. That is acceptable for a small,
trusted beta, but a public or promoted launch should add a shared edge/Redis
limiter and load testing before opening registration broadly.

The current session identity is an HttpOnly random cookie rather than a
verified email/social login. It preserves seats across refreshes and duplicate
tabs on the same browser profile, but account recovery and cross-device identity
require Supabase Auth before a broad public launch.
