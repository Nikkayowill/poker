// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { setMonitor } from "@/lib/monitoring/monitor";

Sentry.init({
  // Production only. The DSN below is a literal, so without this every
  // `npm run dev` session and every Playwright run reported into the live
  // project -- half-written code and deliberately-exercised error paths
  // landing beside real user errors, against the same event quota.
  //
  // It also cost real time: tests/e2e/multiplayer.spec.ts:89 has to finish its
  // six-player setup inside the 15s turn clock that starts when the hand is
  // dealt, and queued beacons pushed it past.
  enabled: process.env.NODE_ENV === "production",
  dsn: "https://efb9926f9cb083a49673e5d2c9dfd59e@o4511821964509184.ingest.us.sentry.io/4511821967130624",

  // Sampled, not exhaustive. At 1 every page load and every route change built
  // a transaction with a span per fetch and beaconed it to Sentry. A tenth is
  // plenty to see a trend on a play-money app, and real errors are not sampled
  // by this number at all.
  tracesSampleRate: 0.1,
  // Enable logs to be sent to Sentry
  enableLogs: true,

  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
});

// The rest of the app reports through this rather than importing the SDK
// itself -- see lib/monitoring/monitor.ts for what that import costs a page
// function. This file is the one place the browser SDK is named.
setMonitor({
  captureException: (error) => Sentry.captureException(error),
  captureMessage: (message, options) => Sentry.captureMessage(message, options),
  addBreadcrumb: (crumb) => Sentry.addBreadcrumb(crumb),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
