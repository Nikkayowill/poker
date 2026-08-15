import type { Metadata } from "next";
import { StorePageClient } from "./store-page-client";

export const metadata: Metadata = {
  title: "Support StackChips",
};

// The page itself stays a plain server component so `metadata` can live
// here — the searchParams read (and the Suspense boundary it requires) is
// pushed into the client child instead of an awaited `searchParams` prop,
// so this route can still be statically prerendered. See store-page-client.tsx.
export default function StorePage() {
  return <StorePageClient />;
}
