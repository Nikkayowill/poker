import type { PublicSeat } from "./types";

/**
 * A bot that voluntarily stood up between hands and is staggered before a
 * replacement takes the seat (see `releaseBustedSeats` in engine.ts).
 * `reseatEligibleAt` is the one signal that tells this apart from every
 * other reason a seat is `"out"` -- a busted human's rebuy grace, a seat
 * claimed mid-hand and waiting for the next deal -- engine.ts's own comment
 * on the field calls it "the one place this ever gets set". Nothing about
 * the seat's identity (name, avatar, initials, accent) is touched by the
 * departure itself; only `reseat()`, the moment a new bot actually sits
 * down, overwrites it. That is what lets the client keep rendering the
 * departed bot's own figure here rather than an empty chair.
 *
 * Kept in lib/game rather than on the component that uses it: it's a pure
 * read of game-state fields, not React, and the only way to unit-test it --
 * vitest.config.ts's `include` only covers the lib and app directories, so
 * a components/ test file silently never runs.
 */
export function isBotAway(seat: PublicSeat): boolean {
  return seat.status === "out" && seat.reseatEligibleAt !== null;
}

/**
 * Whether this seat may be challenged to a duel directly from the table.
 *
 * `profileId` is the durable identity a *registered* human seat carries (see
 * its own doc comment on `Seat` in types.ts) -- null for a bot, an open seat,
 * and a guest, whose profile dies with its cookie and could never accept a
 * challenge addressed to it. `isMine` rules out challenging yourself. Kept
 * here rather than inline in the seat component for the same reason
 * isBotAway is: it's a pure read of snapshot fields, and vitest.config.ts's
 * `include` only covers lib/ and app/, so a components/ test never runs.
 */
export function isChallengeableSeat(seat: PublicSeat): boolean {
  return !seat.isMine && seat.isHuman && seat.profileId !== null;
}
