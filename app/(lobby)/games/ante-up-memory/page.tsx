import { redirect } from "next/navigation";

/**
 * `/games/ante-up-memory` folded into `/games/memory` on 2026-08-21 -- Memory
 * Match has no separate free/wager routes any more, just the one game. This
 * stays mounted only as a redirect for whatever still links the old URL (a
 * bookmark, a stale share, an old e2e path).
 */
export default function AnteUpMemoryRedirect() {
  redirect("/games/memory");
}
