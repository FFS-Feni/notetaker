import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api (REST и WebSocket) проксируется на backend: один origin — cookie сессии работают без CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": { target: process.env.API_URL ?? "http://localhost:8000", ws: true },
    },
  },
});
