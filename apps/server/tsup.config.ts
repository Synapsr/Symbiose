import { defineConfig } from 'tsup';

// Bundle everything (including the TypeScript sources of @symbiose/shared)
// into a single file. Only the native SQLite driver stays external.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^(?!better-sqlite3$).*/],
  external: ['better-sqlite3'],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
