"use client";

import dynamic from "next/dynamic";
import { LoadingScreen } from "@/components/loading/loading-screen";

/**
 * The real farm shell over the top-down world. Its own ssr:false boundary for
 * the same reason as stackacres-farm-dynamic.tsx: the route is an async
 * Server Component and cannot ask for that itself.
 */
export const StackAcresTopdownFarmDynamic = dynamic(
  () =>
    import("@/components/arcade/stackacres/stackacres-farm").then(
      ({ StackAcresFarm }) =>
        function StackAcresTopdownFarm() {
          return <StackAcresFarm worldView="topdown" />;
        },
    ),
  { ssr: false, loading: () => <LoadingScreen /> },
);
