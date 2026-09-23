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
 * Two assets are marked unattributed on purpose rather than guessed: the
 * "isometric plant pack" (44 flora sprites) and the day/dusk/night music
 * have no vendor recorded anywhere in the repo. (The Pixel Pilgrim's own
 * "Houses Pack 3" shrine sprite, monk-house.png, used to be a third --
 * removed along with the shrine itself rather than ever credited.)
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
            The cow, hen, sheep, ox, hog, Ray, the barn, the
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
              <strong>Farmhand &amp; the Pixel Pilgrim</strong> — the walking
              sprite sheet shared by StackAcres&rsquo; farmhand and its monk
              NPC is Throneless&rsquo;s <em>Ranger</em>, from Kayo&rsquo;s own
              2021 Ludum Dare 48 entry.
            </li>
            <li>
              <strong>The people of StackAcres</strong> — the farmer, Ray and
              the travelers are built from the{" "}
              <a href="https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator">
                Universal LPC Spritesheet Character Generator
              </a>
              , art from the Liberated Pixel Cup collection on OpenGameArt.
              Drawn by Benjamin K. Smith (BenCreating), bluecarrot16, Durrani,
              Eliza Wyatt (ElizaWy), Evert, Inboxninja, JaidynReiman, Joe
              White, Johannes Sjölund (wulax), Manuel Riecke (MrBeast), Marcel
              van de Steeg (MadMarcel), Matthew Krohn (makrohn), Michael
              Whitlock (bigbeargames), MuffinElZangano, Napsio (Vitruvian
              Studio), Nila122, Pierre Vigier (pvigier), Stephen Challener
              (Redshrike), TheraHedwig and Tuomo Untinen (reemax), under CC0,
              OGA-BY 3.0, CC-BY 3.0 and CC-BY 4.0. The full list, layer by
              layer, is in{" "}
              <a href="/stackacres-td/characters/CREDITS.md">CREDITS.md</a>.
            </li>
            <li>
              <strong>The land</strong> — the ground, water, paths and props on
              the map use Liberated Pixel Cup terrain art by Lanea Zimmerman
              (Sharm), Daniel Eddeland, Casper Nilsson, Johann Charlot, Skyler
              Robert Colladay, Stephen Challener (Redshrike), Charles Sanchez
              (CharlesGabriel), Manuel Riecke (MrBeast) and Daniel Armstrong
              (HughSpectrum), under CC-BY-SA 3.0 and GPL 3.0.
            </li>
            <li>
              <strong>Lettering</strong> — Pixelify Sans by Stefie Justprince
              and Baloo 2 by Ek Type, both under the SIL Open Font License.
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
