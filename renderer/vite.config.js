// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  // 👉 Emit all asset urls as relative (./foo.js instead of /foo.js)
  base: './',

  // your source root:
  root: path.resolve(__dirname, 'src'),

  plugins: [react()],

  build: {
    // output folder at project root
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'src/index.html'),
        table: path.resolve(__dirname, 'src/table.html'),
      },
    },
  },
});
