import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
  },
})
