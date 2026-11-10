import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // API in dev: `npm run dev:server` (Hono on 8787). Same-origin for the browser,
    // so the session cookie and the Origin check just work. SSE (/api/events) is
    // streamed through as is (http-proxy does not buffer).
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: false },
    },
  },
  build: {
    // The game data (species, moves…) is most of the JS; keep it, the vendor libs
    // and the app code in separate chunks so each caches on its own and loads in parallel.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'game-data', test: /src[\\/]data[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/](react|react-dom|scheduler|@base-ui|i18next|react-i18next|zustand|@floating-ui)/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
    // Server tests each load PGlite: with vitest's default (cores - 1 workers) a few
    // parallel runs exhaust RAM on a 16 GB laptop. Override with VITEST_MAX_WORKERS.
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS) || 4,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts', 'server/**/*.test.ts'],
  },
})
