import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Next.js special-cases this import at build time; it isn't a real
      // installed package, so point it at a local no-op for tests.
      "server-only": new URL("./lib/server/server-only-stub.ts", import.meta.url).pathname,
      // Mirrors tsconfig.json's "@/*" -> "./*" path mapping, which Next.js
      // resolves natively but Vitest doesn't know about on its own.
      "@": new URL(".", import.meta.url).pathname,
    },
  },
  test: {
    // app/ included so the stylesheet structure checks run. Nothing else
    // reads CSS -- tsc and eslint are blind to it by construction -- so an
    // unparseable stylesheet otherwise passes every gate and only shows up
    // as an unstyled page at runtime.
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
  },
});
