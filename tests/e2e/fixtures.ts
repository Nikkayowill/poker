import { test as base, type Browser, type BrowserContext } from "@playwright/test";

/**
 * Closes the first-run spotlight tour the moment it appears.
 *
 * lib/onboarding/use-onboarding-tour.ts fires a driver.js tour for any
 * profile without `onboardingTourCompletedAt`, which every guest a spec
 * creates is, and its overlay is a full-viewport SVG that swallows the click
 * on whatever the spec meant to press. The spec then sits there until it
 * times out. That is not a product bug -- the tour is supposed to be in
 * front -- but no spec accounted for it, and it is why most of this suite
 * could not get past its first interaction.
 *
 * Watched rather than dismissed at a point each spec picks: there are two
 * tours (lobby and table, see lib/onboarding/tour-steps.ts) and each waits
 * for its own targets to be on screen first, so the moment one shows up
 * differs per spec. Observing removes the timing question entirely.
 *
 * Clicking the tour's own close button, not Escape. Escape closes the tour,
 * but it also closes whatever the app has open behind it -- it shut the
 * notification panel that `/?notifications=1` had just opened.
 */
function closeTourOnSight() {
  const CLOSE = ".driver-popover-close-btn";
  const close = () => {
    document.querySelector<HTMLElement>(CLOSE)?.click();
  };
  const watch = () => {
    close();
    new MutationObserver(close).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  };
  // This runs before the document has an element to observe.
  if (document.documentElement) watch();
  else document.addEventListener("DOMContentLoaded", watch, { once: true });
}

/**
 * The shared `test` for this suite. Import it instead of @playwright/test.
 *
 * The tour watcher is installed in two places on purpose. The `context`
 * fixture covers the default `page`, and `browser.newContext` is wrapped
 * because roughly half these specs build their own context to set a viewport
 * (every table spec does) and a context made that way never passes through a
 * fixture at all.
 *
 * Nothing here covers the tour itself. A spec written for it should import
 * `test` from @playwright/test directly.
 */
export const test = base.extend<{ context: BrowserContext }, { browser: Browser }>({
  // `provide`, not the conventional `use`: it is a positional callback, and
  // eslint-plugin-react-hooks reads a call to anything named `use` as a React
  // hook and fails the rules-of-hooks check on it.
  context: async ({ context }, provide) => {
    await context.addInitScript(closeTourOnSight);
    await provide(context);
  },

  browser: [async ({ browser }, provide) => {
    const openContext = browser.newContext.bind(browser);
    browser.newContext = async (options) => {
      const context = await openContext(options);
      await context.addInitScript(closeTourOnSight);
      return context;
    };
    try {
      await provide(browser);
    } finally {
      browser.newContext = openContext;
    }
  }, { scope: "worker" }],
});

export {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
  type Response,
  type Route,
} from "@playwright/test";
