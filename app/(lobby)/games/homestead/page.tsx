import type { Metadata } from "next";
import { HomesteadFarm } from "@/components/arcade/homestead/homestead-farm";

export const metadata: Metadata = {
  title: "StackChips Homestead",
  robots: { index: false, follow: false },
};

/**
 * Anyone with the URL can play this. It is kept off the arcade floor by its
 * `unlisted` catalog status rather than by a gate -- see lib/arcade/games.ts.
 *
 * It used to sit under /admin behind an admin session, which worked but made
 * it awkward to even look at: the admin cookie is scoped `path=/api/admin`
 * and is per-origin, so a preview deploy without ADMIN_SECRET locked staff
 * out along with everyone else. `noindex` is what keeps it out of search
 * while it is unannounced; it is not a security boundary, and the routes
 * behind it are open, so treat this as live for anything that moves Gold.
 */
export default function HomesteadPage() {
  return <HomesteadFarm />;
}
