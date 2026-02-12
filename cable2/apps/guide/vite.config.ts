import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
// We serve the Guide from Vite (dev + preview) on port 5173, while the backend
// server runs separately on 8787. In dev, `server.proxy` handles this, but in
// production on Pis we run `vite preview`, so we must also configure `preview.proxy`.
const proxy = {
  "/api": {
    target: "http://localhost:8787",
  },
  "/media": {
    target: "http://localhost:8787",
  },
  "/cache": {
    target: "http://localhost:8787",
  },
  "/stash": {
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
      "/swpc": {
        target: "http://localhost:8787",
      },
      "/ambient": {
        target: "http://localhost:8787",
      },
      "/embed": {
        target: "http://localhost:8787",
      },
  "/roadmap": {
    target: "http://localhost:8787",
  },
  "/ws": {
    target: "ws://localhost:8787",
    ws: true,
  },
} as const;

export default defineConfig({
  plugins: [
    react(),
    // reactScan()
  ],
  server: {
    proxy,
  },
  preview: {
    proxy,
  },
});
