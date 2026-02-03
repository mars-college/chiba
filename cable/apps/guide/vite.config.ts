import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // reactScan()
  ],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8787",
      },
      "/media": {
        target: "http://localhost:8787",
      },
      "/village": {
        target: "http://localhost:8787",
      },
      "/village.jpg": {
        target: "http://localhost:8787",
      },
      "/weatherstar": {
        target: "http://localhost:8787",
      },
      "/weatherstar.jpg": {
        target: "http://localhost:8787",
      },
      "/mars": {
        target: "http://localhost:8787",
      },
      "/embed": {
        target: "http://localhost:8787",
      },
      "/ws": {
        target: "ws://localhost:8787",
        ws: true,
      },
    },
  },
});
