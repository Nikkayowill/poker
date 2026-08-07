"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerProfile } from "@/lib/profile/types";
import type { StakesTier } from "@/lib/game/tiers";
import { celebrationTier, isCelebration } from "@/lib/arcade/hud";
import { useArcadeSound } from "./use-arcade-sound";

/**
 * The client half of a staked arcade machine.
 *
 * Every casino table does the same four things: hold one snapshot and replace
 * it wholesale with whatever the API returns, resync from a 409 rather than
 * getting stuck, tally settled rounds exactly once, and make a noise when one
 * lands. Blackjack and Hi-Lo each wrote that out by hand and the two already
 * differ in small ways; four more copies would be four more.
 *
 * The server is the authority for all of it. Nothing here decides an outcome,
 * a payout or what is legal -- a machine renders `round` and sends intents,
 * exactly like the poker table.
 */

/** The least a snapshot must carry for the shared bookkeeping to work. */
export interface MachineRound {
  id: string;
  version: number;
  stake: number;
  netGold: number;
}

interface MachineResponse<TRound> {
  round: TRound | null;
  profile: PlayerProfile;
  error?: string;
}

/** How many settled rounds the marquee remembers. Enough to read as a run, short enough to fit one row. */
export const MACHINE_HISTORY_LENGTH = 12;

export interface CasinoMachine<TRound> {
  profile: PlayerProfile | null;
  round: TRound | null;
  /** False until the first response lands. A gate must not be *worded* as a verdict before then. */
  loaded: boolean;
  busy: boolean;
  error: string | null;
  sessionNet: number;
  roundsPlayed: number;
  /** Settled rounds this session, newest first, capped at MACHINE_HISTORY_LENGTH. */
  history: TRound[];
  /**
   * Opens a round at a stake. POSTs to the machine's own endpoint.
   *
   * `choice` carries anything picked alongside the stake -- roulette's bet,
   * baccarat's side. It is not optional decoration: those two games are
   * meaningless without it, and an earlier version of this hook silently
   * dropped it, so every bet reached the server as a bare `{ tier }` and was
   * refused by the schema.
   */
  deal: (tier: StakesTier, choice?: Record<string, unknown>) => void;
  /**
   * Sends an action to `<endpoint>/actions`, stamped with the round's id and
   * version so no caller can forget the concurrency guard.
   *
   * The round is a parameter rather than something read back out of state,
   * which is the point: a component only renders an action button when it has
   * a live round in hand, so it can pass the exact one it drew the button
   * from. Reading it from a ref inside the handler instead would be both the
   * pattern `react-hooks/refs` flags and a way to send last render's version.
   */
  act: (round: TRound, body: Record<string, unknown>) => void;
  dismissError: () => void;
}

export function useCasinoMachine<TRound extends MachineRound>(options: {
  /** e.g. "/api/arcade/roulette". Actions go to the same path plus "/actions". */
  endpoint: string;
  /** Whether a snapshot represents a finished round. Each game words its own phase. */
  isSettled: (round: TRound) => boolean;
}): CasinoMachine<TRound> {
  const { endpoint, isSettled } = options;

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [round, setRound] = useState<TRound | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionNet, setSessionNet] = useState(0);
  const [roundsPlayed, setRoundsPlayed] = useState(0);
  const [history, setHistory] = useState<TRound[]>([]);

  const play = useArcadeSound();
  /** Round ids already tallied -- a resume re-delivers a settled round by design. */
  const scored = useRef<Set<string>>(new Set());

  const send = useCallback(
    async (url: string, body?: unknown) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(url, {
          method: body === undefined ? "GET" : "POST",
          cache: "no-store",
          ...(body === undefined
            ? {}
            : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        });
        const data = (await response.json()) as Partial<MachineResponse<TRound>>;
        if (data.profile) setProfile(data.profile);
        if (!response.ok) {
          setError(data.error ?? "That did not go through. Try again.");
          // A 409 carries the true round, so a client that fell behind resyncs
          // from the error rather than staying stuck on a dead screen.
          if (data.round !== undefined) setRound(data.round ?? null);
          return;
        }
        setRound(data.round ?? null);
      } catch {
        setError("Could not reach the table. Check your connection.");
      } finally {
        setBusy(false);
        setLoaded(true);
      }
    },
    [],
  );

  useEffect(() => {
    // Deferred a tick so the first paint is the empty machine rather than a
    // suspended render, matching the two tables that already exist.
    const timer = window.setTimeout(() => void send(endpoint), 0);
    return () => window.clearTimeout(timer);
  }, [send, endpoint]);

  /**
   * Tally settled rounds as a reaction to the round changing, not inside the
   * fetch path. Two reasons, both of which the existing tables record: a ref
   * belongs in an effect rather than in a chain reachable from a click handler
   * (react-hooks/refs is right to flag that), and every path that can produce
   * a settled round -- an action, a resume, a 409 carrying the true state --
   * goes through `round`, so there is one place to get this right instead of
   * three.
   */
  useEffect(() => {
    if (!round || !isSettled(round) || scored.current.has(round.id)) return;
    scored.current.add(round.id);
    setSessionNet((total) => total + round.netGold);
    setRoundsPlayed((count) => count + 1);
    setHistory((previous) => [round, ...previous].slice(0, MACHINE_HISTORY_LENGTH));
    // `lose` and the rest of the quiet events are null in the manifest, so a
    // loss is deliberately silent rather than reaching for a stand-in.
    if (isCelebration(celebrationTier(round.netGold, round.stake))) play("win");
    else if (round.netGold > 0) play("chips");
  }, [round, isSettled, play]);

  const deal = useCallback(
    (tier: StakesTier, choice?: Record<string, unknown>) => {
      play("deal");
      void send(endpoint, { tier, ...choice });
    },
    [send, endpoint, play],
  );

  const act = useCallback(
    (current: TRound, body: Record<string, unknown>) => {
      void send(`${endpoint}/actions`, { roundId: current.id, version: current.version, ...body });
    },
    [send, endpoint],
  );

  const dismissError = useCallback(() => setError(null), []);

  return {
    profile,
    round,
    loaded,
    busy,
    error,
    sessionNet,
    roundsPlayed,
    history,
    deal,
    act,
    dismissError,
  };
}
