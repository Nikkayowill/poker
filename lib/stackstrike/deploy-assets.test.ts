import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

describe("deploy ignore list", () => {
  it("does not drop any StackStrike file from the Vercel upload", () => {
    // A pattern with no slash matches that name at any depth, so a bare `art`
    // once kept public/stackstrike/art off production and the characters 404ed.
    const bare = readFileSync(path.join(ROOT, ".vercelignore"), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.includes("/"));
    const hits: string[] = [];
    for (const file of filesUnder(path.join(ROOT, "public/stackstrike"))) {
      const segments = path.relative(ROOT, file).split(path.sep);
      for (const pattern of bare) if (segments.includes(pattern)) hits.push(`${pattern} -> ${segments.join("/")}`);
    }
    expect(hits).toEqual([]);
  });
});
