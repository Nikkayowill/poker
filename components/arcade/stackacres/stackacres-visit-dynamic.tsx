"use client";

import dynamic from "next/dynamic";
import { LoadingScreen } from "@/components/loading/loading-screen";

/**
 * Visitor Mode's code-split boundary, in its own file for the same reason
 * stackacres-farm-dynamic.tsx is: `ssr: false` is the point of it, and the
 * route is an async Server Component (it reads the session cookie), which
 * cannot ask for that.
 *
 * It pulls in the same Phaser world the farm does, so it must not be
 * server-rendered and must not be in the farm page's own bundle.
 */
export const StackAcresVisitDynamic = dynamic(
  () => import("./stackacres-visit").then((module) => module.StackAcresVisit),
  { ssr: false, loading: () => <LoadingScreen /> },
);
