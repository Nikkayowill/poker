/**
 * Carry the six seat renders *inside* the published artifact.
 *
 * The artifact page's CSP allows no fetches, so nothing can be loaded from
 * /avatars3d at runtime. esbuild's dataurl loader inlines `.webp` imports —
 * but only imports it can see, and `spriteSrc` builds its path from a
 * template string at runtime, which no bundler can follow. So the six files
 * are imported explicitly here and registered as the resolver.
 *
 * Importing this module is the whole API: it is a side effect on purpose,
 * so the demo entry needs one line rather than threading a prop through
 * the scene the way the old illustrated standees did.
 *
 * Next's bundler types a `.webp` import as StaticImageData while esbuild
 * makes it a plain string; `urlOf` accepts both so this file typechecks
 * under `next build` and runs under the artifact bundle.
 */

import { setSpriteSourceResolver, type SpriteAngleId } from "@/lib/game3d/avatar-sprites";
import back from "@/public/avatars3d/back.webp";
import backleft45 from "@/public/avatars3d/backleft45.webp";
import backright45 from "@/public/avatars3d/backright45.webp";
import front from "@/public/avatars3d/front.webp";
import frontleft45 from "@/public/avatars3d/frontleft45.webp";
import frontright45 from "@/public/avatars3d/frontright45.webp";

const urlOf = (imported: unknown): string =>
  typeof imported === "string" ? imported : (imported as { src: string }).src;

const INLINED: Record<SpriteAngleId, string> = {
  back: urlOf(back),
  backleft45: urlOf(backleft45),
  backright45: urlOf(backright45),
  front: urlOf(front),
  frontleft45: urlOf(frontleft45),
  frontright45: urlOf(frontright45),
};

setSpriteSourceResolver((id) => INLINED[id]);
