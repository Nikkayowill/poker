"use client";

import dynamic from "next/dynamic";
import { LoadingScreen } from "@/components/loading/loading-screen";

/**
 * The farm's code-split boundary, in its own file because `ssr: false` is the
 * point of it and the route is an async Server Component (it reads the session
 * cookie), which cannot ask for that. Same shape as poker-app.tsx's boundary
 * around PokerTable.
 *
 * It saves server-rendering 5,000 lines of client component into HTML nobody
 * reads: the farm needs a canvas, a gesture and a fetch before it shows
 * anything real. Phaser itself is lazier still, behind a runtime import()
 * inside stackacres-world.tsx.
 *
 * The `loading` screen is not optional here the way it is for PokerTable --
 * this replaces the whole viewport, so without it the gap is a blank page.
 */
export const StackAcresFarmDynamic = dynamic(
  () => import("./stackacres-farm").then((module) => module.StackAcresFarm),
  { ssr: false, loading: () => <LoadingScreen /> },
);
