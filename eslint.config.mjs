import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  // .claude/worktrees holds full checkouts other concurrent sessions use for
  // isolated work -- unignored, `npm run lint` was scanning every one of them
  // too, inflating one 5-file diff's lint run into 80k+ reported problems
  // (found 2026-08-19 chasing what looked like a real regression and wasn't).
  globalIgnores([".next/**", "coverage/**", "next-env.d.ts", ".claude/**"]),
  // Farm server code reaches the rest of the app only through the wallet, so
  // StackAcres can move to its own database later without untangling it.
  {
    files: ["lib/server/stackacres-*.ts", "lib/server/stone-node-store.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex:
                "^(\\./|@/lib/server/)(?!(stackacres-)|(stone-node-store|supabase-admin|profile-store|arcade-request)$)",
              message: "StackAcres server code may only use other lib/server modules through profile-store.",
            },
          ],
        },
      ],
    },
  },
]);
