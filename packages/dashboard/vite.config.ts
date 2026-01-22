import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Controller port for dev proxy (default: 24422 for chiba)
const controllerPort = process.env.CONTROLLER_PORT || '24422';
const controllerTarget = `http://localhost:${controllerPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3011,
    host: true,
    proxy: {
      '/api': {
        target: controllerTarget,
        changeOrigin: true,
      },
      '/ws': {
        target: controllerTarget,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
