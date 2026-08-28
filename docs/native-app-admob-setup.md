# Native app + real rewarded-ad Gold: what's left to do

This branch (`feat/capacitor-admob-rewarded-ads`) has the Capacitor Android shell and the AdMob
server-side-verified (SSV) rewarded-ad flow fully built and tested. What's left needs your own
accounts/tools — nothing here is a code gap.

## 1. ~~Apply the database migration~~ — done

Both migrations (`20260828182015_admob_ssv_receipts.sql`, the table, and
`20260828183213_admob_ssv_receipts_daily_cap_trigger.sql`, the atomic daily-cap guard added after code
review) are applied to production. Nothing to do here.

## 2. Android Studio / SDK, and a first real build

None of this exists on the machine I built the code on, and it needs a GUI + real device/emulator, so
it's yours to do:

1. Install [Android Studio](https://developer.android.com/studio) (bundles the SDK).
2. From the worktree root: `npx cap sync android`, then `npx cap open android` to launch the project
   in Android Studio.
3. Run it on an emulator or a real device. Confirm: the real `stackchips.app` site loads in the
   WebView, sign-in works, and a full hand of poker plays end to end.
4. Once that works, you'll eventually want a signing key and a Play Console account for a real release
   — not needed yet for local testing.

## 3. AdMob account + ad unit

The native rewarded-ad path does nothing until this exists:

1. Create an account at [admob.google.com](https://admob.google.com) (needs a Google account; expect
   a short review/verification step on Google's end).
2. Register the Android app (use the same `app.stackchips.mobile` app id from `capacitor.config.ts`,
   or update that file if you pick a different one). Copy the **App ID** it gives you (looks like
   `ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY`) into
   `android/app/src/main/res/values/strings.xml`'s `admob_app_id` string, replacing the placeholder
   value there (a real dev/test app id from Google, so a build doesn't crash before you have your own
   — but it's not yours, so nothing beyond "the app starts" works until you swap it).
3. Create one **rewarded video** ad unit.
4. Turn on **Server-side verification (SSV)** for that ad unit. AdMob will ask for a callback URL —
   give it:
   ```
   https://www.stackchips.app/api/ads/admob/ssv
   ```
   Nothing else to configure there — verification uses Google's own published rotating public keys,
   not a secret you type in.
5. Copy the ad unit's id (looks like `ca-app-pub-XXXXXXXXXXXXXXXX/YYYYYYYYYY`) into this repo's env as
   `NEXT_PUBLIC_ADMOB_REWARDED_AD_UNIT_ID` (see `.env.example` for where it's documented) — both
   locally and in Vercel's project settings, since that's a `NEXT_PUBLIC_` var baked into the client
   bundle at build time.
6. While testing, also grab AdMob's **test ad unit id** and set
   `NEXT_PUBLIC_ADMOB_USE_TEST_ADS=true` locally so you're not spending real ad budget or risking your
   account for serving test traffic against a real unit. Turn that flag back off before a real release
   build.

## 4. Merge

Once 2–3 are done and a real device confirms an ad plays and Gold actually lands (watch for it via the
in-app balance, or query `admob_ssv_receipts` directly), this is ready to merge like any other branch.

## What's already done, for reference

- `capacitor.config.ts`, `android/` — Capacitor Android project, remote mode pointed at the live site.
- `app/api/ads/admob/ssv/route.ts` — Google's SSV callback, signature-verified against Google's
  rotating public keys before anything runs.
- `app/api/profile/gold/admob-status/route.ts` — lets the native client poll for its own credit
  landing (the SSV callback is server-to-server; the device never sees it directly).
- `lib/server/admob-ssv-service.ts` / `admob-ssv-store.ts` / `admob-keys.ts` — verification, the
  idempotency ledger, and the key-fetch/cache.
- `lib/ads/admob-native.ts`, `components/rewards/rewarded-ad-modal.tsx` — the native client flow.
- `lib/server/admob-ssv-service.test.ts` — 9 tests against a real generated EC key pair, including a
  tampered-signature rejection, a reward-amount-spoofing rejection, and a real-concurrency test proving
  the daily cap holds when every callback for the day arrives at once.
- A `/code-review` pass caught three real issues, all fixed: a missing `AndroidManifest.xml` entry the
  Google Mobile Ads SDK requires to initialize at all (a placeholder Google test App ID is in place so a
  dev build doesn't crash — see step 3 above for swapping in the real one), a daily-cap race where two
  callbacks arriving close together could both pass a check-then-insert, closed by a BEFORE INSERT
  trigger with an advisory lock (`admob_ssv_receipts_daily_cap_trigger.sql`), and `@capacitor/cli`
  misplaced in `dependencies` instead of `devDependencies`.
- Full `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `npx vitest run` all pass (one
  pre-existing, unrelated failure in `lib/scene/table-anchors.test.ts` — a known regression from PR
  #163, documented in project memory, not touched by this branch).
