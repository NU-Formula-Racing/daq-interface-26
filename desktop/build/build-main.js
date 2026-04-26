#!/usr/bin/env node
// Bundle desktop/main/src/electron-main.ts to a CJS file Electron can load.
// We inject a banner that recreates `import.meta.url` for the CJS context,
// because esbuild's --define only accepts literals/identifiers and several
// of our source files use `fileURLToPath(import.meta.url)` to compute paths.
import { build } from 'esbuild';

await build({
  entryPoints: ['main/src/electron-main.ts'],
  outfile: 'main/dist/electron-main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron', 'pg-native'],
  // Replace every `import.meta.url` reference with our banner-defined identifier.
  define: {
    'import.meta.url': '__bundleMetaUrl',
  },
  banner: {
    js: 'var __bundleMetaUrl = require("url").pathToFileURL(__filename).href;',
  },
  logLevel: 'info',
});
