import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Served from cable server at /ops/
  base: '/ops/',
  server: {
    proxy: {
      // Ops UI runs on its own Vite dev server; proxy API back to cable server.
      '/api': {
        target: 'http://localhost:8787',
      },
    },
  },
})
