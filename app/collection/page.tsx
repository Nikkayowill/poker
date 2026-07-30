import type { Metadata } from "next";
import { Collection } from "@/components/store/collection";

export const metadata: Metadata = {
  title: "Collection · StackChips",
};

export default function CollectionPage() {
  return <Collection />;
}
