"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Send, Spade, UserMinus, UserPlus, X } from "lucide-react";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import type { GameSnapshot } from "@/lib/game/types";
import type { PlayerProfile } from "@/lib/profile/types";
import type {
  FriendSummary,
  FriendsOverview,
  PendingRequest,
  PendingTableInvite,
} from "@/lib/social/types";

/**
 * The empty overview, used before the first fetch lands and after a failure.
 *
 * A constant rather than null so every render below can read `.friends`
 * without a guard, and so a failed refetch shows an empty list plus the error
 * rather than blanking the drawer to a spinner it will never leave.
 */
const EMPTY: FriendsOverview = { friends: [], incoming: [], outgoing: [] };

/**
 * The two ways this feature says no, which are different problems with
 * different buttons -- the same split lib/server/api-auth.ts makes.
 *
 * 401 is no session at all; 403 is a real guest session that is simply not a
 * registered account. Collapsing either into the generic error would tell a
 * signed-out visitor that something went wrong, when nothing did.
 */
const SIGNED_OUT_STATUS = 401;
const GUEST_STATUS = 403;

/**
 * How often the open drawer re-reads its invites.
 *
 * An invite is live for five minutes (TABLE_INVITE_TTL_MS) and points at a
 * table running right now, so a list that only loaded when the drawer opened
 * would offer seats that are already gone and miss the one that just arrived.
 * /api/invites/pending allows 120/minute precisely so a client can poll; four
 * a minute leaves that untouched even with several tabs open.
 */
const INVITE_POLL_MS = 15_000;

type Gate = "none" | "signed-out" | "guest";

/** The invite's remaining life, in the coarsest unit that is still honest. */
function expiresIn(expiresAt: string, now: number): string {
  const remaining = new Date(expiresAt).getTime() - now;
  if (remaining <= 0) return "Expired";
  const minutes = Math.floor(remaining / 60_000);
  return minutes >= 1 ? `${minutes}m left` : `${Math.max(1, Math.ceil(remaining / 1000))}s left`;
}

/**
 * Reuses the table/profile avatar rather than drawing another circle.
 *
 * `avatarCosmetic` is empty because the friends payload carries no cosmetics
 * -- FriendSummary is a deliberately narrow projection, not a profile. An
 * unrecognised id makes ProfileAvatar fall through to the monogram on the
 * player's accent, which is the correct rendering for a list that never
 * fetched an equipped avatar, not a fallback for a failure.
 */
function Avatar({ person }: { person: FriendSummary | PendingRequest }) {
  return <ProfileAvatar profile={{ ...person, avatarCosmetic: "" }} />;
}

export interface FriendsDrawerProps {
  onClose: () => void;
  /**
   * The private table the player is sitting at, when the drawer was opened
   * from one. Its presence is what turns each friend row into an invite: a
   * table invite carries a room code server-side, so there is nothing to
   * invite anyone *to* from the lobby.
   */
  inviteGameId?: string | null;
  /**
   * Where an accepted invite lands.
   *
   * Accepting is a join -- the route redeems the room code into a seat and
   * returns the snapshot -- so the drawer has a live table on its hands and no
   * business rendering one. Optional because the drawer is also opened from
   * places that have nowhere to put a table; where it is absent, Join is not
   * offered rather than being offered and doing nothing.
   */
  onJoinedTable?: (payload: { game: GameSnapshot; profile: PlayerProfile }) => void;
}

export function FriendsDrawer({ onClose, inviteGameId, onJoinedTable }: FriendsDrawerProps) {
  const [overview, setOverview] = useState<FriendsOverview>(EMPTY);
  const [invites, setInvites] = useState<PendingTableInvite[]>([]);
  /**
   * Friends already invited to this table in this session.
   *
   * The server is the authority -- a second invite comes back
   * `already_pending` from the partial unique index -- but the *sender* has no
   * feed of their own outgoing invites to read, so without this the button
   * they just pressed would look untouched.
   */
  const [invited, setInvited] = useState<ReadonlySet<string>>(new Set());
  /** Ticks the countdowns. Kept beside the list rather than inside each row so one timer serves all of them. */
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<Gate>("none");
  /** Which profile/request ids have a mutation in flight, so their row can disable. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  /**
   * Guards every setState after an await. The drawer is unmounted by closing
   * it, which is the single most likely thing to happen while a request is in
   * flight -- and a mutation that resolves afterwards would otherwise be a
   * state update on a dead component.
   */
  const mounted = useRef(true);
  /**
   * Which load is the newest, so a slow one cannot overwrite a newer answer.
   *
   * Loads overlap in ordinary use: every mutation refetches, so accepting two
   * requests quickly puts two GETs in flight, and nothing guarantees they
   * resolve in order. Without this, the older response lands last and the
   * drawer shows the list as it was *before* the second accept -- a row that
   * reappears after the player watched it go.
   */
  const loadSeq = useRef(0);

  /**
   * Deliberately sets no loading flag of its own.
   *
   * `loading` starts true, so the first call has nothing to announce, and a
   * refetch after a mutation must not blank the list back to a spinner -- the
   * row that triggered it is already disabled through `busy`, which is the
   * feedback that belongs there.
   */
  const load = useCallback(async () => {
    const seq = (loadSeq.current += 1);
    // Still mounted, and still the newest request. Both have to be re-checked
    // after every await, not just the first: parsing the body is a second
    // suspension point, and a newer load can win the race during it.
    const current = () => mounted.current && seq === loadSeq.current;
    try {
      const response = await fetch("/api/friends", { cache: "no-store" });
      if (!current()) return;
      if (response.status === SIGNED_OUT_STATUS || response.status === GUEST_STATUS) {
        setGate(response.status === GUEST_STATUS ? "guest" : "signed-out");
        setOverview(EMPTY);
        setError(null);
        return;
      }
      if (!response.ok) throw new Error("Could not load your friends.");
      const data = (await response.json()) as FriendsOverview;
      if (!current()) return;
      setOverview(data);
      setGate("none");
      setError(null);
    } catch {
      if (!current()) return;
      setError("Could not load your friends.");
    } finally {
      if (current()) setLoading(false);
    }
  }, []);

  /**
   * Reads the invite list, and never reports its own failure.
   *
   * Separate from `load` on purpose: this one polls, and a transient failure on
   * a background poll must not replace the friends list the player is reading
   * with an error banner. The gate is `load`'s to decide -- both routes make
   * the same 401/403 split, so a signed-out visitor is already being told.
   */
  const loadInvites = useCallback(async () => {
    try {
      const response = await fetch("/api/invites/pending", { cache: "no-store" });
      if (!response.ok) {
        // A gate is not an error, but it does mean there is nothing to show.
        if (response.status === SIGNED_OUT_STATUS || response.status === GUEST_STATUS) {
          if (mounted.current) setInvites([]);
        }
        return;
      }
      const data = (await response.json()) as { invites: PendingTableInvite[] };
      if (mounted.current) setInvites(data.invites ?? []);
    } catch {
      // Left as-is: the previous list is closer to the truth than an empty one,
      // and every row carries its own expiry, which the countdown enforces.
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    // Deferred through a timer rather than called straight from the effect
    // body, matching the profile load in components/poker-app.tsx: a fetch
    // kicked off synchronously here sets state during the same commit.
    const timer = window.setTimeout(() => {
      void load();
      void loadInvites();
    }, 0);
    // One interval drives both the refetch and the countdown: a row that has
    // just lapsed should stop being offered, not merely read "Expired".
    const poll = window.setInterval(() => {
      setNow(Date.now());
      void loadInvites();
    }, INVITE_POLL_MS);
    return () => {
      mounted.current = false;
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
  }, [load, loadInvites]);

  useEffect(() => {
    // Whatever opened the drawer -- the lobby's Friends tile in practice.
    // Captured rather than selected by class so focus returns to the real
    // trigger even if something else ever opens this.
    const opener = document.activeElement as HTMLElement | null;
    // Captured now because the cleanup below runs after React has already
    // detached the node, at which point drawerRef.current is null.
    const drawer = drawerRef.current;
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      // Without this, Tab walks straight out of an aria-modal dialog into the
      // lobby behind it -- the hub tiles stay in the tab order, so a keyboard
      // user ends up operating controls they cannot see.
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      // Wrap at both ends, and treat focus that has already escaped the drawer
      // as "at the start" so it is pulled back in rather than left outside.
      if (event.shiftKey && (active === first || !drawerRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      // Only if focus is still ours to move. Something else may legitimately
      // have taken it -- the sign-in flow, say -- and yanking it back to the
      // tile then would be the bug rather than the fix.
      if (!drawer || drawer.contains(document.activeElement)) {
        opener?.focus?.();
      }
    };
  }, [onClose]);

  /**
   * Runs one mutation and refetches.
   *
   * Refetch rather than patching local state: accepting a request moves a row
   * from `incoming` to `friends`, and the server is the only thing that knows
   * whether it actually did -- the other party may have cancelled first. A
   * list this short costs one cheap GET to be certain instead of guessing.
   */
  const mutate = useCallback(async (key: string, request: () => Promise<Response>, failure: string) => {
    setBusy((current) => new Set(current).add(key));
    try {
      const response = await request();
      if (!mounted.current) return;
      if (!response.ok) {
        setError(failure);
        return;
      }
      setError(null);
      await load();
    } catch {
      if (mounted.current) setError(failure);
    } finally {
      if (!mounted.current) return;
      setBusy((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, [load]);

  const unfriend = (profileId: string) => mutate(
    profileId,
    () => fetch(`/api/friends?profileId=${encodeURIComponent(profileId)}`, { method: "DELETE" }),
    "Could not remove that friend.",
  );

  const respond = (requestId: string, action: "accept" | "decline" | "cancel") => mutate(
    requestId,
    () => fetch(`/api/friends/requests/${encodeURIComponent(requestId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }),
    "Could not update that request.",
  );

  /**
   * Offers a friend the seat next to you.
   *
   * `already_pending` is treated as success, because to the player it is one:
   * they asked for this person to be invited and this person is invited. The
   * distinction only exists because the partial unique index refuses the
   * second row.
   */
  const invite = useCallback(async (profileId: string) => {
    if (!inviteGameId) return;
    const key = `invite:${profileId}`;
    setBusy((current) => new Set(current).add(key));
    try {
      const response = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, gameId: inviteGameId }),
      });
      if (!mounted.current) return;
      const data = (await response.json().catch(() => null)) as { status?: string; error?: string } | null;
      if (!response.ok) {
        setError(data?.error ?? "Could not send that invite.");
        return;
      }
      if (data?.status === "sent" || data?.status === "already_pending") {
        setInvited((current) => new Set(current).add(profileId));
        setError(null);
        return;
      }
      // `blocked` reaches here, and stays undifferentiated for the reason the
      // route gives: naming the direction of a block undoes it.
      setError("That player can't be invited right now.");
    } catch {
      if (mounted.current) setError("Could not send that invite.");
    } finally {
      if (!mounted.current) return;
      setBusy((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, [inviteGameId]);

  /**
   * Answers an invite. Accepting seats the player, so the snapshot goes up.
   *
   * The row is dropped locally before the refetch rather than after: accepting
   * unmounts this drawer (the app swaps the lobby for a table), and declining
   * should not leave a dead row on screen for a poll interval.
   */
  const answerInvite = useCallback(async (inviteId: string, action: "accept" | "decline") => {
    setBusy((current) => new Set(current).add(inviteId));
    try {
      const response = await fetch(`/api/invites/${encodeURIComponent(inviteId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json().catch(() => null)) as
        | { status?: string; error?: string; game?: GameSnapshot; profile?: PlayerProfile }
        | null;
      if (!mounted.current) return;
      if (!response.ok) {
        setError(data?.error ?? "Could not answer that invite.");
        setInvites((current) => current.filter((row) => row.id !== inviteId));
        return;
      }
      setError(null);
      setInvites((current) => current.filter((row) => row.id !== inviteId));
      if (action === "accept" && data?.game && data.profile) {
        onJoinedTable?.({ game: data.game, profile: data.profile });
      }
    } catch {
      if (mounted.current) setError("Could not answer that invite.");
    } finally {
      if (!mounted.current) return;
      setBusy((current) => {
        const next = new Set(current);
        next.delete(inviteId);
        return next;
      });
    }
  }, [onJoinedTable]);

  /** Only the invites still worth offering; the poll is 15s and a row can lapse inside one. */
  const liveInvites = invites.filter((row) => new Date(row.expiresAt).getTime() > now);
  const total = overview.friends.length + overview.incoming.length + overview.outgoing.length;

  return (
    <div
      className="history-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        className="history-drawer friends-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Friends"
      >
        <div className="panel-heading">
          <div>
            <span>YOUR TABLE</span>
            <strong>Friends</strong>
          </div>
          <button ref={closeButtonRef} className="modal-close" onClick={onClose} aria-label="Close friends">
            <X size={16} />
          </button>
        </div>

        <div className="friends-list">
          {error && <p className="friends-error" role="alert">{error}</p>}

          {gate === "guest" && (
            <div className="friends-empty friends-upsell">
              <UserPlus size={20} aria-hidden="true" />
              <strong>Friends need an account</strong>
              <p>
                A guest profile lives only in this browser, so a friendship would
                disappear with it. Save your progress to keep a friends list.
              </p>
            </div>
          )}

          {gate === "signed-out" && (
            <div className="friends-empty friends-upsell">
              <UserPlus size={20} aria-hidden="true" />
              <strong>Sign in to see your friends</strong>
              <p>Your friends list travels with your account, not with this browser.</p>
            </div>
          )}

          {gate === "none" && loading && total === 0 && liveInvites.length === 0 && (
            <p className="friends-loading" role="status">Loading your friends…</p>
          )}

          {gate === "none" && !loading && total === 0 && liveInvites.length === 0 && !error && (
            <div className="friends-empty">
              <UserPlus size={20} aria-hidden="true" />
              <strong>No friends yet</strong>
              {/* Honest about the current state of the feature rather than
                  pointing at an "add friend" control that does not exist: the
                  seat menu that sends a request is the next slice. */}
              <p>Add people you meet at the table, and they&rsquo;ll show up here.</p>
            </div>
          )}

          {liveInvites.length > 0 && (
            <section className="friends-section friends-invites" aria-label="Table invites">
              <h3>Invites · {liveInvites.length}</h3>
              {liveInvites.map((row) => (
                <div className="friend-row friend-row-invite" key={row.id}>
                  <Avatar person={row} />
                  <div className="friend-identity">
                    <strong>{row.displayName}</strong>
                    <small>
                      {row.smallBlind.toLocaleString()}/{row.bigBlind.toLocaleString()}
                      {" · "}
                      <span className="invite-countdown">{expiresIn(row.expiresAt, now)}</span>
                    </small>
                  </div>
                  <div className="friend-actions">
                    {/* Join is offered only where there is somewhere to land.
                        Accepting redeems the invite -- it is spent whether or
                        not this drawer can render the table it just joined. */}
                    {onJoinedTable && (
                      <button
                        type="button"
                        className="friend-accept invite-join"
                        disabled={busy.has(row.id)}
                        onClick={() => void answerInvite(row.id, "accept")}
                      >
                        <Spade size={13} aria-hidden="true" />
                        Join
                      </button>
                    )}
                    <button
                      type="button"
                      className="friend-decline"
                      disabled={busy.has(row.id)}
                      onClick={() => void answerInvite(row.id, "decline")}
                      aria-label={`Decline ${row.displayName}'s invite`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}

          {overview.incoming.length > 0 && (
            <section className="friends-section" aria-label="Friend requests">
              <h3>Requests · {overview.incoming.length}</h3>
              {overview.incoming.map((person) => (
                <div className="friend-row" key={person.id}>
                  <Avatar person={person} />
                  <div className="friend-identity">
                    <strong>{person.displayName}</strong>
                    <small>wants to be friends</small>
                  </div>
                  <div className="friend-actions">
                    <button
                      type="button"
                      className="friend-accept"
                      disabled={busy.has(person.id)}
                      onClick={() => void respond(person.id, "accept")}
                      aria-label={`Accept ${person.displayName}`}
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      className="friend-decline"
                      disabled={busy.has(person.id)}
                      onClick={() => void respond(person.id, "decline")}
                      aria-label={`Decline ${person.displayName}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}

          {overview.friends.length > 0 && (
            <section className="friends-section" aria-label="Friends">
              <h3>Friends · {overview.friends.length}</h3>
              {overview.friends.map((person) => (
                <div className="friend-row" key={person.profileId}>
                  <Avatar person={person} />
                  <div className="friend-identity">
                    <strong>{person.displayName}</strong>
                    <small>
                      Friends since {new Date(person.since).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </small>
                  </div>
                  <div className="friend-actions">
                    {inviteGameId && (
                      <button
                        type="button"
                        className="friend-invite"
                        disabled={busy.has(`invite:${person.profileId}`) || invited.has(person.profileId)}
                        onClick={() => void invite(person.profileId)}
                        aria-label={`Invite ${person.displayName} to your table`}
                      >
                        {invited.has(person.profileId)
                          ? <><Check size={13} aria-hidden="true" />Invited</>
                          : <><Send size={13} aria-hidden="true" />Invite</>}
                      </button>
                    )}
                    <button
                      type="button"
                      className="friend-remove"
                      disabled={busy.has(person.profileId)}
                      onClick={() => void unfriend(person.profileId)}
                      aria-label={`Remove ${person.displayName}`}
                    >
                      <UserMinus size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}

          {overview.outgoing.length > 0 && (
            <section className="friends-section" aria-label="Sent requests">
              <h3>Sent · {overview.outgoing.length}</h3>
              {overview.outgoing.map((person) => (
                <div className="friend-row friend-row-muted" key={person.id}>
                  <Avatar person={person} />
                  <div className="friend-identity">
                    <strong>{person.displayName}</strong>
                    <small>Waiting for a reply</small>
                  </div>
                  <div className="friend-actions">
                    <button
                      type="button"
                      className="friend-decline"
                      disabled={busy.has(person.id)}
                      onClick={() => void respond(person.id, "cancel")}
                      aria-label={`Cancel request to ${person.displayName}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>

        <div className="panel-footnote">Friends are kept to your account</div>
      </aside>
    </div>
  );
}
