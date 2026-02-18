import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
// We serve the Guide from Vite (dev + preview) on port 5173, while the backend
// control API runs separately on 8795. In dev, `server.proxy` handles this, but in
// production on Pis we run `vite preview`, so we must also configure `preview.proxy`.
const proxy = {
  "/api": {
    target: "http://localhost:8795",
  },
  "/media": {
    target: "http://localhost:8795",
  },
  "/cache": {
    target: "http://localhost:8795",
  },
  "/stash": {
    target: "http://localhost:8795",
  },
  "/village": {
    target: "http://localhost:8795",
  },
  "/village.jpg": {
    target: "http://localhost:8795",
  },
  "/weatherstar": {
    target: "http://localhost:8795",
  },
  "/weatherstar.jpg": {
    target: "http://localhost:8795",
  },
      "/mars": {
        target: "http://localhost:8795",
      },
      "/swpc": {
        target: "http://localhost:8795",
      },
      "/ambient": {
        target: "http://localhost:8795",
      },
      "/embed": {
        target: "http://localhost:8795",
      },
  "/roadmap": {
    target: "http://localhost:8795",
  },
  "/ws": {
    target: "ws://localhost:8795",
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
