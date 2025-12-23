import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Keep asset names simple
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/media': 'http://localhost:8080',
      '/ws': {
        target: 'ws://localhost:8081',
        ws: true
      }
    }
  }
})
