import type { DriveStep } from "driver.js";

/**
 * Spotlight tour content, split by screen so the lobby half and the table
 * half can fire independently -- see useOnboardingTour. `element` selectors
 * are `data-tour` attributes rather than existing class names, so a styling
 * pass renaming a class never silently breaks a step's target.
 *
 * Copy mirrors the reviewed mockup (Artifact "Spotlight Tour"). Keep this
 * the only place tour wording lives; components just point at it.
 */
export const LOBBY_TOUR_STEPS: DriveStep[] = [
  {
    element: '[data-tour="game-tiles"]',
    popover: {
      title: "Four ways to play",
      description:
        "Hold'em is the main event, but Blackjack, Ante Up, and StackAcres are all one tap away — same Gold balance, same account.",
    },
  },
  {
    element: '[data-tour="seat-row"]',
    popover: {
      title: "Grab an open seat",
      description:
        "Tap any open table to set your buy-in and sit down. No lobby queue, no waiting on a host.",
    },
  },
  {
    element: '[data-tour="gold-balance"]',
    popover: {
      title: "That's your Gold",
      description: "Every game shares one balance. Win a hand here, spend it at Ray's shop in StackAcres later.",
    },
  },
];

export const TABLE_TOUR_STEPS: DriveStep[] = [
  {
    element: '[data-tour="action-bar"]',
    popover: {
      title: "Fold, call, or raise",
      description: "Your options live here, and only here — greyed out the instant it isn't your turn.",
    },
  },
  {
    element: '[data-tour="chip-stack"]',
    popover: {
      title: "The pot",
      description: "Every bet this hand lands here. It updates the moment anyone acts, and clears the second a hand pays out.",
    },
  },
  {
    element: '[data-tour="turn-timer"]',
    popover: {
      title: "The clock is real",
      description: "You get 15 seconds to act. Let it run out and you're auto-folded — nobody holds up the table.",
    },
  },
];
