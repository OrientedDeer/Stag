/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  return {
  plugins: [react(), tailwindcss()],
  // Defaults to the GitHub Pages sub-path; self-hosted deploys serving at a
  // domain root should set VITE_BASE_PATH=/ in .env (otherwise asset URLs 404).
  base: env.VITE_BASE_PATH || "/Stag/",
  // --- ADD THIS SECTION ---
  esbuild: {
    keepNames: true, // This prevents class names from being minified (e.g. SavedAccount -> S)
  },
  // -----------------------
  // ES-module workers so the Monte Carlo worker (#98) can use the same code-split
  // ESM imports as the main bundle (the simulation engine). Dev serves
  // `{ type: 'module' }` workers natively; the build needs this to emit ESM.
  worker: {
    format: 'es',
  },
  build: {
    chunkSizeWarningLimit: 1000, 
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@nivo')) {
              return 'nivo';
            }
            return 'vendor';
          }
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: path.resolve(__dirname, './src/setupTests.ts'),
    // Exclude git worktrees under .claude/ — parallel agents check out full
    // copies of the repo there, and vitest would otherwise run their (often
    // half-finished) test files alongside the real suite.
    exclude: ['**/node_modules/**', '**/e2e/**', '**/.claude/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/components/**/*{Context,Engine,Service,models}.{ts,tsx}',
        'src/components/**/use*.{ts,tsx}',
        'src/tabs/**/*Utils.{ts,tsx}'
      ],
      exclude: [
        'node_modules/',
        'src/setupTests.ts',
        'src/__tests__/**'
      ],
    },
  },
  };
});