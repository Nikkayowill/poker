"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, Sprout } from "lucide-react";
import { StackAcresLogo } from "@/components/brand/stackacres-logo";
import {
  SHOWCASE_REACTIONS,
  type ShowcaseReactionId,
  type StackAcresShowcase,
} from "@/lib/stackacres/showcase";
import { gameDayAt, gameHourAt } from "@/lib/stackacres/clock";
import { STACKACRES_STARTING_CUTTER } from "@/lib/stackacres/cutters";
import { StackAcresTopdownWorld } from "../stackacres-td/topdown-world";
import type { StackAcresWorldApi } from "./world-contract";

/**
 * Visitor Mode: somebody else's farm, read-only.
 *
 * ONE RENDERER, NOT A SECOND ONE. The map is the same
 * `StackAcresTopdownWorld` the owner's own farm draws, handed the same field
 * names off the snapshot (lib/stackacres/showcase.ts's `ShowcaseWorld`), with
 * `visitor` set. A separate visitor renderer would drift, and a visitor shown
 * a farm that does not look like the real one is the one bug this feature
 * cannot have.
 *
 * THE CALLBACKS ARE NOT THE LOCK. Every handler below is a no-op, but that is
 * belt to two suspenders: the scene refuses taps and stick pushes outright in
 * visitor mode, and -- the part that actually matters -- there is no request a
 * visitor could send that would reach this farm. Farm mutations go through
 * POST /api/stackacres/actions, which resolves the farm from the caller's own
 * session token and has no parameter for whose farm to act on.
 *
 * The failure states are first-class rather than a spinner that never stops:
 * a farm that is not open, a farm that will not load, and a phone that has
 * gone offline each say so and offer the one thing that helps.
 */

function noop(): void {}

/** The farm clock as the OWNER'S farm keeps it. A visitor looking at a farm
 *  at dusk should see dusk, not their own afternoon. */
function clockFrom(showcase: StackAcresShowcase | null) {
  const offset = showcase?.world.clock.offsetMs ?? 0;
  return {
    hour: () => gameHourAt(Date.now(), offset),
    day: () => gameDayAt(Date.now(), offset),
  };
}

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; showcase: StackAcresShowcase }
  | { phase: "closed"; message: string }
  | { phase: "failed"; message: string };

/**
 * One request for a farm, and what each answer means on screen.
 *
 * Outside the component because it sets no state: 404 and 401 are the
 * server's single "not open to you" (see lib/server/farm-showcase-visits.ts
 * on why every refusal is the same), a thrown fetch is the phone rather than
 * the server, and anything else is a fault worth a Try again.
 */
async function fetchShowcase(profileId: string): Promise<LoadState> {
  try {
    const response = await fetch(`/api/stackacres/showcase/${profileId}`, { cache: "no-store" });
    const body = response.ok ? null : ((await response.json().catch(() => null)) as { error?: string } | null);
    if (response.status === 404 || response.status === 401) {
      return { phase: "closed", message: body?.error ?? "That farm isn't open to visitors." };
    }
    if (!response.ok) {
      return { phase: "failed", message: body?.error ?? "That farm didn't load." };
    }
    return { phase: "ready", showcase: (await response.json()) as StackAcresShowcase };
  } catch {
    return { phase: "failed", message: "That farm didn't load. Check your connection." };
  }
}

export function StackAcresVisit({ profileId }: { profileId: string }) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [reacting, setReacting] = useState<ShowcaseReactionId | null>(null);
  const [thanks, setThanks] = useState<string | null>(null);
  // `ssr: false` (stackacres-visit-dynamic.tsx), so `navigator` is really
  // there by the time this initialiser runs.
  const [online, setOnline] = useState(() => navigator.onLine);
  const worldApi = useRef<StackAcresWorldApi | null>(null);

  const retry = useCallback(() => {
    setState({ phase: "loading" });
    void (async () => setState(await fetchShowcase(profileId)))();
  }, [profileId]);

  // The fetch is an inline async call rather than a `load()` this effect
  // invokes, so no setState happens synchronously in the effect body
  // (react-hooks/set-state-in-effect). `cancelled` covers the profile id
  // changing under an in-flight request.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await fetchShowcase(profileId);
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  // The banner is driven by the browser's own flag rather than by a failed
  // fetch: a visitor who walks into a lift should be told why the page has
  // stopped answering before they tap Try again three times.
  //
  // Subscribe only -- the first value comes from the state initialiser above,
  // so nothing calls setState synchronously in here.
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const react = useCallback(
    async (reaction: ShowcaseReactionId, label: string) => {
      if (state.phase !== "ready" || reacting) return;
      setReacting(reaction);
      try {
        const response = await fetch(`/api/stackacres/showcase/${profileId}/reactions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reaction }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setThanks(body?.error ?? "That reaction didn't send.");
          return;
        }
        const result = (await response.json()) as Pick<StackAcresShowcase, "reactions" | "sent">;
        setState({
          phase: "ready",
          showcase: { ...state.showcase, reactions: result.reactions, sent: result.sent },
        });
        setThanks(`"${label}" sent.`);
      } catch {
        setThanks("That reaction didn't send. Check your connection.");
      } finally {
        setReacting(null);
      }
    },
    [profileId, reacting, state],
  );

  const showcase = state.phase === "ready" ? state.showcase : null;
  const clock = clockFrom(showcase);

  return (
    <main className="duel-shell ante-shell sa-shell sa-visit">
      <header className="sa-visit-bar">
        <Link href="/games/stackacres" className="sa-visit-back" aria-label="Back to your farm">
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Your farm</span>
        </Link>
        <StackAcresLogo variant="stacked" className="sa-visit-mark" alt="" aria-hidden="true" />
      </header>

      {!online && (
        <p className="sa-visit-offline" role="status">
          You&apos;re offline. This farm is as it was when the page loaded.
        </p>
      )}

      {showcase && (
        <section className="sa-visit-card" aria-label={`${showcase.owner.displayName}'s farm`}>
          <div className="sa-visit-who">
            <span className="sa-visit-avatar" style={{ background: showcase.owner.accent }} aria-hidden="true">
              {showcase.owner.initials}
            </span>
            <div>
              <h1>{showcase.owner.displayName}</h1>
              <p>{showcase.own ? "Your farm, as a visitor sees it" : "Looking around. Nothing here can be touched."}</p>
            </div>
          </div>
          <dl className="sa-visit-stats">
            <div>
              <dt>Farm level</dt>
              <dd>{showcase.stats.farmLevel}</dd>
            </div>
            <div>
              <dt>Chapter</dt>
              <dd>
                {showcase.stats.chapter
                  ? `${showcase.stats.chapter.number} · ${showcase.stats.chapter.title}`
                  : "All six done"}
              </dd>
            </div>
            <div>
              <dt>Mostly raising</dt>
              <dd>
                {showcase.stats.favoriteProduction
                  ? `${showcase.stats.favoriteProduction.label} · ${showcase.stats.favoriteProduction.count}`
                  : "Nothing yet"}
              </dd>
            </div>
          </dl>
        </section>
      )}

      <div className="sa-main">
        <div className="sa-field sa-visit-field">
          {showcase && (
            <StackAcresTopdownWorld
              visitor
              units={showcase.world.units}
              soilTiles={showcase.world.soilTiles}
              woodNodes={showcase.world.woodNodes}
              stoneNodes={showcase.world.stoneNodes}
              forageNodes={showcase.world.forageNodes}
              landObstacles={showcase.world.landObstacles}
              fences={showcase.world.fences}
              guardDogs={showcase.world.guardDogs}
              empireBuildings={showcase.world.empireBuildings}
              grocery={showcase.world.grocery}
              clockHour={clock.hour}
              clockDay={clock.day}
              /* Nothing below this line can do anything. The stick and the
                 Use key are not rendered at all in visitor mode, so the
                 tool, the cutter and the key's label are only here to
                 satisfy the one contract both screens share. */
              tool="inspect"
              cutter={STACKACRES_STARTING_CUTTER}
              useKeyLabel=""
              rodHeld={false}
              onNearWater={noop}
              viewExpansion={1}
              celebrate={null}
              buildMode={false}
              buildGhost={null}
              groceryGhost={null}
              onReady={noop}
              onBuildTap={noop}
              onJobBoardTap={noop}
              onStoreDeskTap={noop}
              onStaffTap={noop}
              tractorOwned={false}
              handHired={false}
              onDrivingChanged={noop}
              onUseSquare={noop}
              onGroundTap={noop}
              onBarnTap={noop}
              onSeedSellerTap={noop}
              onTownBuyerTap={noop}
              onSignpostTap={noop}
              onWorkshopTap={noop}
              onWellTap={noop}
              onDockTap={noop}
              onThicketTap={noop}
              onTreeTap={noop}
              maySwing={() => false}
              onStoneTap={noop}
              onForageTap={noop}
              onLandTap={noop}
              onGreenhouseTap={noop}
              onRayTap={noop}
              onHouseTap={noop}
              onBedTap={noop}
              onTravelerTap={noop}
              onSecretZoneTap={noop}
              onQuestPlaceTap={noop}
              onViewMoved={noop}
              onPlaceEntered={noop}
              api={worldApi}
            />
          )}

          {state.phase === "loading" && (
            <div className="sa-loading">
              <StackAcresLogo variant="stacked" className="sa-loading-logo" alt="" aria-hidden="true" />
            </div>
          )}

          {(state.phase === "closed" || state.phase === "failed") && (
            <div className="sa-loading">
              <StackAcresLogo variant="stacked" className="sa-loading-logo" alt="" aria-hidden="true" />
              <div className="sa-loading-error" role="alert">
                <p>{state.message}</p>
                {/* A closed farm is an answer, not a hiccup -- offering
                    "Try again" on it would invite somebody to sit there
                    retrying a door that is locked on purpose. */}
                {state.phase === "failed" ? (
                  <button type="button" className="sa-cta" onClick={retry}>
                    Try again
                  </button>
                ) : (
                  <Link href="/games/stackacres" className="sa-cta">
                    Back to your farm
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {showcase && !showcase.own && (
        <footer className="sa-visit-react" aria-label="Leave a reaction">
          {SHOWCASE_REACTIONS.map((reaction) => {
            const sent = showcase.sent.includes(reaction.id);
            return (
              <button
                key={reaction.id}
                type="button"
                className={clsx("sa-cta", "sa-visit-reaction", { "is-sent": sent })}
                disabled={sent || reacting !== null}
                onClick={() => void react(reaction.id, reaction.label)}
              >
                <Sprout size={13} aria-hidden="true" />
                <span>{reaction.label}</span>
                <strong>{showcase.reactions[reaction.id]}</strong>
              </button>
            );
          })}
          {thanks && (
            <p className="sa-visit-thanks" role="status">
              {thanks}
            </p>
          )}
        </footer>
      )}

      {showcase?.own && (
        <footer className="sa-visit-react" aria-label="Your own farm">
          <p className="sa-visit-thanks" role="status">
            This is how your farm looks to a visitor. They can pan and pinch, and that is all.
          </p>
        </footer>
      )}
    </main>
  );
}
