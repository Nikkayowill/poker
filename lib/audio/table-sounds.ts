import type { GameSnapshot } from "@/lib/game/types";
import type { SoundEffect } from "./manifest";
import { soundForSeatAction } from "./seat-action-sound";

/**
 * What the table sounds like between two snapshots.
 *
 * A pure function over (previous, current) rather than a chain of playSound
 * calls inside an effect, which is what this was. The behaviour is unchanged;
 * what changes is that it can be tested. This is six intertwined rules --
 * which of them fire together, which suppress each other, which are edge
 * triggered -- and none of them had a test, in a milestone whose entire
 * subject is those rules.
 *
 * Returns effects in the order they should be played. They all start in the
 * same tick regardless, so the order is documentation of intent rather than
 * timing: what happened, then whose turn it is, then how the hand ended.
 */
export function tableSounds(
  previous: GameSnapshot | null,
  current: GameSnapshot | null,
): SoundEffect[] {
  // The same table, moving forward. A snapshot that repeats a version -- a
  // realtime echo arriving just behind the fetch that already applied it --
  // must be silent, or every sound in the hand plays twice. Sitting down at a
  // table is silent too: there is no "previous" to have changed from, and
  // announcing a hand already in progress as though it just happened is the
  // wrong first impression.
  if (!current || !previous) return [];
  if (current.id !== previous.id || current.version <= previous.version) return [];

  const sounds: SoundEffect[] = [];
  const seatBefore = (id: string) => previous.seats.find((seat) => seat.id === id);

  if (current.handNumber > previous.handNumber) {
    // A new hand supersedes everything the old one was still saying.
    sounds.push("deal");
  } else {
    const revealed = current.community.length - previous.community.length;
    if (revealed === 3 && previous.community.length === 0) sounds.push("flop");
    else if (revealed > 0) sounds.push("card");

    const chipsMoved = current.seats.some((seat) => {
      const before = seatBefore(seat.id);
      return before && seat.streetBet > before.streetBet;
    });
    if (chipsMoved) sounds.push("chips");

    // Everyone else's action, which used to make no sound at all: fold,
    // check, call and raise fired only from the local player's own act(),
    // so five other players could be doing all of it in silence.
    //
    // Own seat skipped because act() has already played it on tap -- that
    // one is deliberately optimistic so a decision feels immediate rather
    // than waiting on a round trip.
    //
    // One sound per snapshot, not one per seat. A catch-up advance can
    // resolve several overdue turns in a single response, and playing all
    // of them at once is a clatter rather than a table.
    const acted = current.seats.find((seat) => {
      if (seat.isMine) return false;
      const before = seatBefore(seat.id);
      return before && seat.lastAction !== before.lastAction;
    });
    const seatSound = soundForSeatAction(acted?.lastAction ?? null);
    if (seatSound) sounds.push(seatSound);
  }

  // It is on you now -- the one thing at this table you cannot afford to
  // miss, and the only event here that has to reach a player who is not
  // looking at the screen. The clock is 15 seconds and three missed turns
  // now hands your seat back (M14a), so a table that announced every other
  // player's fold and said nothing about your own turn had the priority
  // exactly backwards.
  //
  // Edge-triggered on the seat *becoming* current rather than being current:
  // snapshots keep arriving while you decide -- a reconnect, a realtime echo,
  // another seat's timer -- and every one of them would sound the cue again
  // over the top of you thinking.
  const mine = current.seats.find((seat) => seat.isMine);
  if (mine?.isCurrent && !seatBefore(mine.id)?.isCurrent) sounds.push("your-turn");

  if (current.status === "complete" && previous.status !== "complete") {
    // The room cheers for whoever won it, not only when it is you. `lose`
    // has no file behind it, so the old branch meant most hands at a
    // six-handed table ended in silence.
    sounds.push("win");
  }

  const latestLog = current.log[0];
  if (latestLog && latestLog.id !== previous.log[0]?.id && latestLog.text.includes("ran out of time")) {
    sounds.push("timeout");
  }

  return sounds;
}
