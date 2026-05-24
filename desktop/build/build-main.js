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
  // duckdb is a native module — keep it as a runtime require so esbuild
  // doesn't try to inline @mapbox/node-pre-gyp's optional aws-sdk/nock deps.
  external: ['electron', 'pg-native', 'duckdb'],
  // Replace every `import.meta.url` reference with our banner-defined identifier.
  define: {
    'import.meta.url': '__bundleMetaUrl',
  },
  banner: {
    js: 'var __bundleMetaUrl = require("url").pathToFileURL(__filename).href;',
  },
  logLevel: 'info',
});

await build({
  entryPoints: ['preload/preload.ts'],
  outfile: 'main/dist/preload.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  logLevel: 'info',
});
