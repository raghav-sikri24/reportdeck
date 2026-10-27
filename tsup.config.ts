import { defineConfig, type Options } from 'tsup';

const shared: Options = {
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  target: 'es2020',
  splitting: true,
  external: ['react', 'react-dom', 'react/jsx-runtime', 'echarts', 'jspdf', 'jspdf-autotable', 'exceljs'],
};

export default defineConfig([
  {
    ...shared,
    entry: { index: 'src/index.ts' },
    clean: true,
    // React components use hooks: mark the entry as a client module for React Server Components.
    banner: { js: '"use client";' },
  },
  {
    ...shared,
    entry: { core: 'src/core/index.ts', export: 'src/export/index.ts', server: 'src/server/index.ts' },
    clean: false,
  },
]);
