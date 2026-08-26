"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SupportPanel } from "@/components/store/support-panel";

// SupportPanel does all its own data fetching client-side and only needs
// `table` to link back to the right game — reading it via useSearchParams
// (not an awaited `searchParams` prop on the page) keeps app/store/page.tsx
// a plain static shell instead of forcing per-request SSR for no
// server-side reason. The Suspense boundary is required or the build opts
// the whole route out of static rendering.
export function StorePageClient() {
  return (
    <Suspense fallback={null}>
      <StorePageContent />
    </Suspense>
  );
}

function StorePageContent() {
  const table = useSearchParams().get("table") ?? undefined;
  return <SupportPanel gameId={table} />;
}
