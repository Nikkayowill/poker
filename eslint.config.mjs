import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  // dist-artifact holds the bundled 3D room (three + React, minified into one
  // file). Linting a build output reports thousands of problems about code
  // nobody wrote, which buries the handful in the source that matter.
  globalIgnores([".next/**", "coverage/**", "next-env.d.ts", "dist-artifact/**"]),
]);
