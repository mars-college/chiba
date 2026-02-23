import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const controlApiTarget =
  process.env.CHIBA3_CONTROL_API_PROXY_TARGET ?? "http://localhost:8795";
const controlApiWsTarget = controlApiTarget.replace(/^http/i, "ws");

// https://vite.dev/config/
// We serve the Guide from Vite (dev + preview) on port 5173, while the backend
// control API runs separately on 8795. In dev, `server.proxy` handles this, but in
// production on Pis we run `vite preview`, so we must also configure `preview.proxy`.
const proxy = {
  "/api": {
    target: controlApiTarget,
  },
  "/media": {
    target: controlApiTarget,
  },
  "/cache": {
    target: controlApiTarget,
  },
  "/stash": {
    target: controlApiTarget,
  },
  "/village": {
    target: controlApiTarget,
  },
  "/village.jpg": {
    target: controlApiTarget,
  },
  "/weatherstar": {
    target: controlApiTarget,
  },
  "/home-assistant": {
    target: controlApiTarget,
  },
  "/weatherstar.jpg": {
    target: controlApiTarget,
  },
  "/mars": {
    target: controlApiTarget,
  },
  "/swpc": {
    target: controlApiTarget,
  },
  "/ambient": {
    target: controlApiTarget,
  },
  "/embed": {
    target: controlApiTarget,
  },
  "/roadmap": {
    target: controlApiTarget,
  },
  "/ws": {
    target: controlApiWsTarget,
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
