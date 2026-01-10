/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/Stag/",
  // --- ADD THIS SECTION ---
  esbuild: {
    keepNames: true, // This prevents class names from being minified (e.g. SavedAccount -> S)
  },
  // -----------------------
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
});