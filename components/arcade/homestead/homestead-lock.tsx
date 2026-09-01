import { Lock } from "lucide-react";
import { FloorBackLink } from "@/components/arcade/floor-back-link";

/**
 * The door. There is nothing to type any more: access is granted per player
 * from the admin dashboard, so the only way through is for someone to add you.
 *
 * A server component, unlike the code prompt it replaces -- nothing here
 * submits anything, and the moment access is granted a plain refresh is what
 * re-decides.
 *
 * It does show the visitor their own player id. That is the string the
 * dashboard's search box matches, so it is the one useful thing this screen
 * can hand someone who has to go and ask.
 */
export function HomesteadLock({ playerId }: { playerId: string | null }) {
  return (
    <main className="duel-shell ante-shell hs-shell">
      <header className="floor-bar">
        <div className="floor-bar-left">
          <FloorBackLink />
        </div>
      </header>

      <div className="hs-gate">
        <div className="hs-gate-card">
          <span className="hs-gate-icon" aria-hidden="true">
            <Lock size={20} />
          </span>
          {/* Same class the farm's own screen uses for its title, so the door
              and the room behind it are named in one voice. */}
          <div className="ante-lobby-heading">
            <h1>StackChips Homestead</h1>
          </div>
          <p>
            A farm of crops and livestock. It is still being built, so it opens one player at a
            time — ask for access and it will be here waiting.
          </p>
          {playerId && (
            <p className="hs-gate-id">
              Your player ID
              <code>{playerId}</code>
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
