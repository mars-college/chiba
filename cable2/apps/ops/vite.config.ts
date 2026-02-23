import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Served from cable server at /ops/
  base: '/ops/',
  server: {
    port: 8792,
    strictPort: true,
    proxy: {
      // cable3 ops + control API.
      '/api/ops': {
        target: 'http://127.0.0.1:8795',
      },
      '/api/c3': {
        target: 'http://127.0.0.1:8795',
        rewrite: (path) => path.replace(/^\/api\/c3/, '/api'),
      },
      '/api': {
        target: 'http://127.0.0.1:8795',
      },
    },
  },
})
