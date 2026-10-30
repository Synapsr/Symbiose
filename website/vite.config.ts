import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * `virtual:screens` lists the app screenshots present in `public/` at build
 * time, so components can pick the best available file (the new webp
 * screens, then the older copies) without ever requesting a missing image.
 */
function screens(): Plugin {
  const id = 'virtual:screens';
  const resolved = '\0' + id;
  const list = (dir: string) => {
    try {
      return readdirSync(join(fileURLToPath(new URL('.', import.meta.url)), 'public', dir))
        .filter((file) => file.endsWith('.webp'))
        .map((file) => `/${dir}/${file}`);
    } catch {
      return [];
    }
  };
  return {
    name: 'symbiose-screens',
    resolveId: (source) => (source === id ? resolved : undefined),
    load(source) {
      if (source !== resolved) return undefined;
      const files = [...list('screens'), ...list('screens-fallback')];
      return `export default ${JSON.stringify(files)};`;
    },
  };
}

export default defineConfig({
  plugins: [react(), screens()],
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 0,
  },
});
