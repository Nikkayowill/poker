"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

/**
 * StackStrike is private for now: only a signed-in admin can open it.
 *
 * The admin session cookie is scoped to /api/admin (app/api/admin/session), so
 * a page request cannot see it. This asks that route instead, and loads the
 * game only on a yes. Everyone else gets what a missing page looks like. The
 * game is a separate chunk, so a signed-out visitor never downloads it
 * through this page.
 *
 * Local dev skips the check so the game opens without an admin key.
 */

const StackStrikeGame = dynamic(() => import("./stackstrike-game").then((module) => module.StackStrikeGame), {
  ssr: false,
});

type Access = "checking" | "allowed" | "denied";

export function StackStrikeGate({ requireAdmin }: { requireAdmin: boolean }) {
  const [access, setAccess] = useState<Access>(requireAdmin ? "checking" : "allowed");

  useEffect(() => {
    if (!requireAdmin) return;
    let cancelled = false;
    fetch("/api/admin/session", { cache: "no-store", credentials: "same-origin" })
      .then((response) => {
        if (!cancelled) setAccess(response.ok ? "allowed" : "denied");
      })
      .catch(() => {
        if (!cancelled) setAccess("denied");
      });
    return () => {
      cancelled = true;
    };
  }, [requireAdmin]);

  if (access === "allowed") return <StackStrikeGame />;
  return (
    <div
      data-testid={access === "denied" ? "stackstrike-denied" : "stackstrike-checking"}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "grid",
        placeItems: "center",
        background: "#000",
        color: "#e6edf3",
        fontFamily: "system-ui, sans-serif",
        fontSize: 15,
      }}
    >
      {access === "denied" ? "404 · This page could not be found." : null}
    </div>
  );
}
