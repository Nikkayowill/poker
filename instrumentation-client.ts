// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  // Production only. The DSN below is a literal, so without this every
  // `npm run dev` session and every Playwright run reported into the live
  // project -- half-written code and deliberately-exercised error paths
  // landing beside real user errors, against the same event quota.
  //
  // It also cost real time. Browser events are tunnelled through this app's
  // own server (tunnelRoute in next.config.ts), so when Sentry is slow or
  // unreachable the dev server blocks on the outbound socket rather than
  // just dropping a beacon. That is what made tests/e2e/multiplayer.spec.ts:89
  // fail: its six-player setup has to finish inside the 15s turn clock that
  // starts when the hand is dealt, and queued tunnel requests pushed it past.
  enabled: process.env.NODE_ENV === "production",
  dsn: "https://efb9926f9cb083a49673e5d2c9dfd59e@o4511821964509184.ingest.us.sentry.io/4511821967130624",

  // Add optional integrations for additional features
  integrations: [Sentry.replayIntegration()],

  // Sampled, not exhaustive. At 1 every page load and every route change built
  // a transaction with a span per fetch and beaconed it through this app's own
  // server (tunnelRoute in next.config.ts) -- so the cost of a slow or
  // unreachable Sentry lands on the player's own connection, which is the
  // failure the comment above already describes in the dev case. A tenth is
  // plenty to see a trend on a play-money app, and real errors are not sampled
  // by this number at all.
  tracesSampleRate: 0.1,
  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
