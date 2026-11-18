"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { openingOwed } from "@/lib/stackacres/opening";
import type { OpeningPhase } from "./stackacres-opening";
import type { StackAcresWorldApi } from "./world-contract";

/** Tries to hand over Ray's seed pouch this many times before leaving it to the next visit. */
const CLAIM_ATTEMPTS = 3;
const CLAIM_RETRY_MS = 1500;
/** Once it is over the bars and the words fade out first, then the HUD fades in, then the overlay goes. */
const HUD_RELEASE_MS = 420;
const ENDING_MS = 1000;
/** The map never came up after the cards: give up on the scene rather than sit on black. */
const SCENE_WAIT_MS = 25_000;
/** Black comes back over a skip this long before the scene is cut, so the jump is not seen. */
const SKIP_COVER_MS = 380;

/** `?opening=1` plays the opening for anyone, for testing. Read when asked, never at render time on the server. */
function replayRequested(): boolean {
  return new URLSearchParams(window.location.search).get("opening") === "1";
}

interface Input {
  hasStarted: boolean;
  loaded: boolean;
  /** The map is up and has drawn its first frame. */
  worldReady: boolean;
  /** Counts every time a map comes up: 0 before the first, and one more each time the shell builds a new one (a phone turned to portrait and back). */
  worldEpoch: number;
  /** The server's answer to "has this farm seen the opening", or null when it has not given one (an offline copy never does). */
  seen: boolean | null;
  /** Asks for Ray's seed pouch. True when the server took it. */
  claimSeeds: () => Promise<boolean>;
  /** The pouch is handed over, so the farm will not be owed the opening again. */
  onClaimed: () => void;
  world: RefObject<StackAcresWorldApi | null>;
  /** The specs turn it off for every fresh farm. */
  off: boolean;
}

/**
 * The shell's side of the opening (lib/stackacres/opening.ts): decides on load whether this farm is
 * owed it, runs the cards, hands over to the map for the scene, and makes sure it always ends: the
 * seed pouch is claimed whether it played out, was skipped or failed, and the black cover is never
 * left on with nothing underneath.
 */
export function useStackAcresOpening(input: Input) {
  const { hasStarted, loaded, worldReady, worldEpoch, seen, off, world } = input;
  const [phase, setPhase] = useState<OpeningPhase | "off">("off");
  const [line, setLine] = useState<string | null>(null);
  const [covered, setCovered] = useState(true);
  const [ending, setEnding] = useState(false);
  // The HUD comes back a beat after the overlay starts to fade, so the two do not swap in one frame.
  const [hudReleased, setHudReleased] = useState(false);
  // True once the check has run, whichever way it came out, so it is made once: the farm's first render with
  // its data in, and never again for the visit.
  const [checked, setChecked] = useState(false);

  const sceneStarted = useRef(false);
  // Which map the scene was handed to, so a map built since (the phone turned) is known to have lost it.
  const sceneEpoch = useRef(0);
  const finished = useRef(false);
  const timers = useRef(new Set<number>());
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });

  const later = useCallback((run: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      run();
    }, ms);
    timers.current.add(id);
  }, []);
  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const id of held) window.clearTimeout(id);
      held.clear();
    };
  }, []);

  // Owed to a farm that has never been handed the pouch, and on request to any. Settled in the very render
  // the farm first shows, not in an effect after it: an effect would let a frame of the loading board and
  // the HUD through before the black cards, and the opening's first beat is a clean cut to black.
  if (!checked && hasStarted && loaded) {
    setChecked(true);
    if (openingOwed({ seen, replay: replayRequested(), off })) setPhase("cards");
  }

  const claim = useCallback(async () => {
    for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
      if (await latest.current.claimSeeds()) {
        latest.current.onClaimed();
        return;
      }
      await new Promise<void>((resolve) => later(resolve, CLAIM_RETRY_MS * (attempt + 1)));
    }
  }, [later]);

  /** However it ends, once: the cover fades, the pouch is claimed, the overlay goes. */
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    setLine(null);
    setEnding(true);
    void claim();
    later(() => setHudReleased(true), HUD_RELEASE_MS);
    later(() => {
      setPhase("off");
      setEnding(false);
      setHudReleased(false);
      setCovered(true);
    }, ENDING_MS);
  }, [claim, later]);

  /** Whether pressing Play now goes into the opening, so the title screen can fade to black for it. */
  const willPlay = useCallback(
    () => openingOwed({ seen: latest.current.seen, replay: replayRequested(), off: latest.current.off }),
    [],
  );

  const finishCards = useCallback(() => setPhase("scene"), []);

  const skip = useCallback(() => {
    const api = world.current;
    // The cards, or the scene has not begun: nothing on the map to cut short.
    if (!sceneStarted.current || !api) {
      finish();
      return;
    }
    setCovered(true);
    later(() => api.skipOpening(), SKIP_COVER_MS);
  }, [world, finish, later]);

  useEffect(() => {
    if (phase !== "scene" || !loaded || !worldReady || sceneStarted.current || finished.current) return;
    const api = world.current;
    if (!api) return;
    sceneStarted.current = true;
    sceneEpoch.current = worldEpoch;
    api.startOpening({
      onLine: setLine,
      onStaged: () => setCovered(false),
      onDone: finish,
    });
  }, [phase, loaded, worldReady, worldEpoch, world, finish]);

  // The scene lives in one map. If the shell built another while it played, the scene went with the old
  // one: the opening ends there rather than starting over under a player who just turned their phone.
  useEffect(() => {
    if (phase !== "scene" || !sceneStarted.current || worldEpoch === sceneEpoch.current) return;
    later(finish, 0);
  }, [phase, worldEpoch, finish, later]);

  useEffect(() => {
    if (phase !== "scene") return;
    const id = window.setTimeout(() => {
      if (!sceneStarted.current) finish();
    }, SCENE_WAIT_MS);
    return () => window.clearTimeout(id);
  }, [phase, finish]);

  return {
    phase,
    line,
    covered,
    ending,
    checked,
    active: phase !== "off",
    /** The map's own controls stay out of sight until the overlay has faded. */
    hidesHud: phase !== "off" && !hudReleased,
    revealing: hudReleased,
    willPlay,
    finishCards,
    skip,
  };
}
