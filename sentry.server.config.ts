// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  // Production only -- see instrumentation-client.ts for the full reasoning.
  // The DSN is a literal, so this is the only switch that exists.
  enabled: process.env.NODE_ENV === "production",
  dsn: "https://efb9926f9cb083a49673e5d2c9dfd59e@o4511821964509184.ingest.us.sentry.io/4511821967130624",

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
});
