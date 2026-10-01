import type { Metadata } from "next";
import { cookies } from "next/headers";
import { StackAcresVisitDynamic } from "@/components/arcade/stackacres/stackacres-visit-dynamic";
import { stackAcresDisplay, stackAcresPixel } from "@/components/arcade/stackacres/stackacres-font";
import { StackAcresLock } from "@/components/arcade/stackacres/stackacres-lock";
import { tokenHasStackAcresAccess } from "@/lib/server/stackacres-access";
import { findProfileBySessionToken } from "@/lib/server/profile-store";
import { readSessionTokenFromCookies } from "@/lib/server/session";
import { resolveStackAcresPrice } from "@/lib/server/stripe";

export const metadata: Metadata = {
  title: "A farm on StackAcres",
  robots: { index: false, follow: false },
};

/**
 * Somebody else's farm, read-only.
 *
 * SAME DOOR AS THE FARM ITSELF. Visiting is part of StackAcres, so it is
 * behind the same access gate, and the same "ask for access" card rather than
 * a 404 -- see app/(lobby)/games/stackacres/page.tsx's own header for why
 * that route does not hide itself either.
 *
 * WHETHER THIS PARTICULAR FARM IS OPEN IS NOT DECIDED HERE. This page renders
 * the same shell whatever id is in the URL; GET /api/stackacres/showcase/[id]
 * is the only thing that decides, and it answers one 404 for a private farm,
 * a stranger's friends-only farm, a block, and an id that never existed. So
 * this page cannot be used to probe who farms -- it looks identical either
 * way and the screen inside it says "that farm isn't open to visitors".
 *
 * Deliberately no dev bypass. The farm page has one so a stock `pnpm dev`
 * checkout can open its own farm; there is no equivalent need here, and an
 * env var that opened other people's farms locally is a thing to get wrong.
 */
export default async function StackAcresVisitPage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await params;
  const store = await cookies();
  const token = readSessionTokenFromCookies((name) => store.get(name)?.value);
  const allowed = await tokenHasStackAcresAccess(token);

  const profile = allowed ? null : token ? await findProfileBySessionToken(token) : null;
  const price = allowed ? null : await resolveStackAcresPrice("live").catch(() => null);
  const offer = price ? { unitAmount: price.unitAmount, currency: price.currency } : null;

  return (
    <div className={`sa-theme ${stackAcresDisplay.variable} ${stackAcresPixel.variable}`}>
      {allowed ? (
        <StackAcresVisitDynamic profileId={profileId} />
      ) : (
        <StackAcresLock
          playerId={profile?.id ?? null}
          offer={offer}
          registered={profile?.isRegistered ?? false}
        />
      )}
    </div>
  );
}
