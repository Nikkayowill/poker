import Link from "next/link";

/**
 * Art/audio attribution for StackAcres. Most of the map is drawn in code
 * (Canvas2D/Phaser painters, no external asset), but a real minority of it
 * is baked PNGs or MP3s from outside sources, and those need real credit.
 *
 * Reuses the /legal shell + .info-page-section like How to Play. Sourcing
 * here came from stackacres-sprites.ts's own header comment and the git
 * history of each asset's introducing commit — see that file before editing
 * this page, since a new sprite belongs there first and here second.
 *
 * Three assets are marked unattributed on purpose rather than guessed: the
 * "isometric plant pack" (44 flora sprites) and the day/dusk/night music
 * have no vendor recorded anywhere in the repo. The monk shrine sprite
 * (monk-house.png, "Houses Pack 3") is being replaced rather than credited —
 * it's still live in-game as of this page shipping, so don't delete the
 * file, just don't list it below.
 */
export function CreditsPage() {
  return (
    <main className="legal-page">
      <header className="legal-page-header">
        <div>
          <p className="legal-page-kicker">StackChips · Credits</p>
          <h1>Art &amp; sound in StackAcres.</h1>
        </div>
        <Link className="legal-page-back" href="/">Back to StackChips</Link>
      </header>

      <article className="legal-page-document">
        <section className="info-page-section">
          <h2>How the farm is drawn</h2>
          <p>
            Most of StackAcres — the ground, the buildings, the crops&rsquo;
            old sprout art, the HUD icons — is drawn in code: shapes and
            gradients painted by hand, not downloaded. A smaller set of
            things are real image or audio files from outside sources, and
            those are credited below.
          </p>
        </section>

        <section className="info-page-section">
          <h2>Generated art</h2>
          <p>
            The cow, hen, sheep, ox, hog, Grandfather Ray, the barn, the
            windmill, and the trowel/iron shovel/golden spade tools were all
            generated locally with FLUX.1-schnell, an open-weight
            text-to-image model, from a &ldquo;flat vector&rdquo; prompt Kayo
            picked after comparing several rounds of output. They&rsquo;re
            original art, not a photo or someone else&rsquo;s drawing — no
            license or credit is owed, it&rsquo;s listed here for the record.
          </p>
        </section>

        <section className="info-page-section">
          <h2>Licensed &amp; sourced art</h2>
          <ul>
            <li>
              <strong>Crops</strong> — all 22 crop sprites (and their growth
              stages) come from CraftPix&rsquo;s &ldquo;Free Farming Crops 3D
              Low Poly Models&rdquo; pack, rendered into flat isometric PNGs
              through Blender.
            </li>
            <li>
              <strong>Farmhand &amp; the Pixel Pilgrim</strong> — the walking
              sprite sheet shared by StackAcres&rsquo; farmhand and its monk
              NPC is Throneless&rsquo;s <em>Ranger</em>, from Kayo&rsquo;s own
              2021 Ludum Dare 48 entry.
            </li>
            <li>
              <strong>Legacy tile art</strong> — a handful of unused tiles
              still sitting in the project (public/stackacres/tiles/) were
              sliced from Kenney&rsquo;s <em>Tiny Farm</em> asset pack
              (kenney.nl), released under CC0 1.0 — public domain, credited
              here anyway.
            </li>
          </ul>
        </section>

        <section className="info-page-section">
          <h2>Unattributed, pending a source</h2>
          <p>
            Two assets currently in the game arrived as files with no vendor
            or license recorded anywhere in the project. They&rsquo;re listed
            here rather than left off entirely:
          </p>
          <ul>
            <li>
              <strong>Wild flora</strong> — the trees, pines, bushes, grass,
              scrub, and weeds scattered across the map come from a supplied
              &ldquo;isometric plant pack,&rdquo; but no pack name or license
              was ever recorded.
            </li>
            <li>
              <strong>Background music</strong> — the day, dusk, and night
              ambient loops have no source on file.
            </li>
          </ul>
        </section>
      </article>
    </main>
  );
}
