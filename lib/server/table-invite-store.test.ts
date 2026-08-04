import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGame } from "@/lib/game/engine";
import { __resetFriendsMemory, blockProfile } from "./friends-store";
import { createStoredGame } from "./game-store";
import { ensureProfile } from "./profile-store";
import {
  __resetTableInvitesMemory,
  createTableInvite,
  expireStaleTableInvites,
  getPendingTableInvites,
  TABLE_INVITE_TTL_MS,
} from "./table-invite-store";

/** A real profile: the store looks the invitee up before it will write a row. */
async function newPlayer(name: string) {
  const profile = await ensureProfile(randomUUID(), name);
  return profile.id;
}

/** A live private table, which is the only kind an invite can point at. */
async function newPrivateTable() {
  const state = createGame(randomUUID(), "Host", undefined, { isPrivate: true });
  await createStoredGame(state);
  return state;
}

async function newPublicTable() {
  const state = createGame(randomUUID(), "Host");
  await createStoredGame(state);
  return state;
}

beforeEach(() => {
  __resetTableInvitesMemory();
  __resetFriendsMemory();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sending a table invite (memory mode)", () => {
  it("delivers a pending invite to the invitee with the table's stakes", async () => {
    const [host, guest] = [await newPlayer("Host"), await newPlayer("Guest")];
    const table = await newPrivateTable();

    const sent = await createTableInvite(host, guest, table.id);
    expect(sent.status).toBe("sent");

    const [invite] = await getPendingTableInvites(guest);
    expect(invite.profileId).toBe(host);
    expect(invite.displayName).toBe("Host");
    expect(invite.gameId).toBe(table.id);
    expect(invite.smallBlind).toBe(table.smallBlind);
    expect(invite.bigBlind).toBe(table.bigBlind);
  });

  it("never puts the room code on the wire", async () => {
    const [host, guest] = [await newPlayer("Host"), await newPlayer("Guest")];
    const table = await newPrivateTable();
    expect(table.roomCode).toMatch(/^[A-Z0-9]{6}$/);

    await createTableInvite(host, guest, table.id);
    const [invite] = await getPendingTableInvites(guest);

    // The whole point of carrying the code in the row: the invitee can accept
    // without ever being handed something they could pass on.
    expect(JSON.stringify(invite)).not.toContain(table.roomCode);
    expect(invite).not.toHaveProperty("roomCode");
  });

  it("does not show the invite to the inviter, or to anyone else", async () => {
    const [host, guest, stranger] = [
      await newPlayer("Host"),
      await newPlayer("Guest"),
      await newPlayer("Stranger"),
    ];
    const table = await newPrivateTable();
    await createTableInvite(host, guest, table.id);

    expect(await getPendingTableInvites(host)).toEqual([]);
    expect(await getPendingTableInvites(stranger)).toEqual([]);
  });

  it("refuses a second live invite to the same player at the same table", async () => {
    const [host, guest] = [await newPlayer("Host"), await newPlayer("Guest")];
    const table = await newPrivateTable();

    await createTableInvite(host, guest, table.id);
    expect(await createTableInvite(host, guest, table.id)).toEqual({ status: "already_pending" });
    expect(await getPendingTableInvites(guest)).toHaveLength(1);
  });

  it("rejects self-invites, unknown players, public tables and tables that have gone", async () => {
    const [host, guest] = [await newPlayer("Host"), await newPlayer("Guest")];
    const privateTable = await newPrivateTable();
    const publicTable = await newPublicTable();

    expect(await createTableInvite(host, host, privateTable.id)).toEqual({ status: "self" });
    expect(await createTableInvite(host, randomUUID(), privateTable.id))
      .toEqual({ status: "unknown_profile" });
    expect(await createTableInvite(host, guest, publicTable.id))
      .toEqual({ status: "table_not_private" });
    expect(await createTableInvite(host, guest, randomUUID())).toEqual({ status: "table_gone" });
  });

  it("will not invite across a block, in either direction", async () => {
    const [host, guest] = [await newPlayer("Host"), await newPlayer("Guest")];
    const table = await newPrivateTable();

    await blockProfile(guest, host);
    expect(await createTableInvite(host, guest, table.id)).toEqual({ status: "blocked" });

    const [other, target] = [await newPlayer("Other"), await newPlayer("Target")];
    await blockProfile(other, target);
    expect(await createTableInvite(other, target, table.id)).toEqual({ status: "blocked" });
  });

  it("hides an invite that was sent before the invitee blocked the inviter", async () => {
    const [host, guest] = [await newPlayer("Host"), await newPlayer("Guest")];
    const table = await newPrivateTable();
    await createTableInvite(host, guest, table.id);
    expect(await getPendingTableInvites(guest)).toHaveLength(1);

    await blockProfile(guest, host);
    expect(await getPendingTableInvites(guest)).toEqual([]);
  });
});

describe("invite expiry", () => {
  it("stamps expires_at five minutes out", async () => {
    const [host, guest] = [await newPlayer("Host"), await newPlayer("Guest")];
    const table = await newPrivateTable();

    const before = Date.now();
    const sent = await createTableInvite(host, guest, table.id);
    if (sent.status !== "sent") throw new Error(`expected sent, got ${sent.status}`);

    const window = new Date(sent.expiresAt).getTime() - before;
    expect(window).toBeGreaterThanOrEqual(TABLE_INVITE_TTL_MS);
    expect(window).toBeLessThan(TABLE_INVITE_TTL_MS + 2_000);
  });

  it("stops returning an invite the moment it lapses, with no sweep in between", async () => {
    const [host, guest] = [await newPlayer("Host"), await newPlayer("Guest")];
    const table = await newPrivateTable();
    await createTableInvite(host, guest, table.id);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + TABLE_INVITE_TTL_MS + 1_000);

    // This is the property the sweep must not be load-bearing for: the row is
    // still marked `pending` here, and the read has to filter it anyway.
    expect(await getPendingTableInvites(guest)).toEqual([]);
  });

  it("settles lapsed rows so the invite can be sent again", async () => {
    const [host, guest] = [await newPlayer("Host"), await newPlayer("Guest")];
    const table = await newPrivateTable();
    await createTableInvite(host, guest, table.id);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + TABLE_INVITE_TTL_MS + 1_000);

    expect(await expireStaleTableInvites()).toBe(1);
    // Idempotent: a second sweep finds nothing left to settle.
    expect(await expireStaleTableInvites()).toBe(0);

    const again = await createTableInvite(host, guest, table.id);
    expect(again.status).toBe("sent");
    expect(await getPendingTableInvites(guest)).toHaveLength(1);
  });

  it("leaves a live invite alone", async () => {
    const [host, guest] = [await newPlayer("Host"), await newPlayer("Guest")];
    const table = await newPrivateTable();
    await createTableInvite(host, guest, table.id);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + TABLE_INVITE_TTL_MS - 30_000);

    expect(await expireStaleTableInvites()).toBe(0);
    expect(await getPendingTableInvites(guest)).toHaveLength(1);
  });
});
