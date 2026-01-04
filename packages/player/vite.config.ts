import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/player/',
  server: {
    port: 3010,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
