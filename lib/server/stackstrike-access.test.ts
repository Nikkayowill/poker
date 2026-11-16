import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { ensureProfile, setStackStrikeAccess } from "./profile-store";
import { tokenHasStackStrikeAccess } from "./stackstrike-access";

/**
 * StackStrike is a private prototype: a profile has to be let in from the
 * admin dashboard before the Play tile shows or the page opens.
 */

const PAGE = join(process.cwd(), "app/stackstrike/page.tsx");

describe("the StackStrike access gate", () => {
  it("gates the page, and a refusal is a 404", () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain("tokenHasStackStrikeAccess");
    expect(source).toContain("notFound()");
  });

  it("refuses a caller with no session at all", async () => {
    expect(await tokenHasStackStrikeAccess(null)).toBe(false);
    expect(await tokenHasStackStrikeAccess("")).toBe(false);
  });

  it("refuses a real player who has not been granted access", async () => {
    const token = `stackstrike-gate-fresh-${Math.random()}`;
    const profile = await ensureProfile(token);
    expect(profile.stackstrikeAccess).toBe(false);
    expect(await tokenHasStackStrikeAccess(token)).toBe(false);
  });

  it("opens for a granted profile and shuts again when it is revoked", async () => {
    const token = `stackstrike-gate-granted-${Math.random()}`;
    const profile = await ensureProfile(token);

    await setStackStrikeAccess(profile.id, true);
    expect(await tokenHasStackStrikeAccess(token)).toBe(true);

    await setStackStrikeAccess(profile.id, false);
    expect(await tokenHasStackStrikeAccess(token)).toBe(false);
  });

  it("grants one profile without opening it for another, and does not touch StackAcres", async () => {
    const granted = `stackstrike-gate-one-${Math.random()}`;
    const other = `stackstrike-gate-two-${Math.random()}`;
    const grantedProfile = await ensureProfile(granted);
    await ensureProfile(other);

    await setStackStrikeAccess(grantedProfile.id, true);
    expect(await tokenHasStackStrikeAccess(granted)).toBe(true);
    expect(await tokenHasStackStrikeAccess(other)).toBe(false);
    expect((await ensureProfile(granted)).stackacresAccess).toBe(false);
  });

  it("refuses to grant access to a profile that does not exist", async () => {
    await expect(setStackStrikeAccess("00000000-0000-4000-8000-000000000000", true)).rejects.toThrow(/not found/i);
  });
});
