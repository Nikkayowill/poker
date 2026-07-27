// Next.js's bundler special-cases the "server-only" import specifier at
// build time; it isn't an installed package. Vitest has no such handling,
// so vitest.config.ts aliases "server-only" to this empty module instead.
export {};
