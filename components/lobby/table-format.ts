/**
 * The three ways to sit down at a poker table, offered together wherever a
 * player picks blinds -- the buy-in modal (desktop/host) and the phone
 * shell's own inline picker both render this same list rather than each
 * hand-writing their own three buttons, so the copy can't drift between the
 * two entry points.
 *
 * Cash is the only format `BuyInModal`/`MobileShell` actually seat a player
 * into themselves; heads-up and tournament are real poker too, but each
 * already has its own matchmaking/registration lobby (`/games/heads-up`,
 * `/games/sit-and-go`), so picking either just navigates there with the
 * chosen tier carried along as `?tier=`, rather than teaching this picker a
 * second copy of either lobby's own quick-play logic.
 */
export type TableFormat = "cash" | "heads-up" | "tournament";

export const TABLE_FORMATS: ReadonlyArray<{ id: TableFormat; label: string; blurb: string }> = [
  { id: "cash", label: "Texas Hold’em", blurb: "6-max, sit down and play" },
  { id: "heads-up", label: "Heads-Up", blurb: "2-max, until someone busts" },
  { id: "tournament", label: "Tournament", blurb: "6-max Sit & Go, winner takes all" },
];
