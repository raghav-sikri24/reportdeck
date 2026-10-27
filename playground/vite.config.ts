import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const src = (p: string) => fileURLToPath(new URL(`../src/${p}`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^reportdeck\/styles\.css$/, replacement: src('styles.css') },
      { find: /^reportdeck\/(core|export)$/, replacement: src('$1/index.ts') },
      { find: /^reportdeck$/, replacement: src('index.ts') },
    ],
  },
  server: { port: 5199, strictPort: true },
});
