import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api (REST и WebSocket) проксируется на backend: один origin — cookie сессии работают без CORS.
export default defineConfig({
  plugins: [react()],
  // Зависимости собираются сразу при старте, а не при первом открытии страницы:
  // иначе первая загрузка медленная, а Vite посреди неё перезагружает страницу.
  optimizeDeps: {
    include: [
      "@mantine/core", "@mantine/dates", "@mantine/hooks", "@mantine/notifications",
      "@fullcalendar/react", "@fullcalendar/core", "@fullcalendar/core/locales/ru", "@fullcalendar/daygrid",
      "@fullcalendar/timegrid", "@fullcalendar/interaction", "@fullcalendar/luxon3",
      "@tanstack/react-query", "@tanstack/react-virtual", "react-router", "luxon", "dayjs", "dayjs/locale/ru",
      "react", "react-dom/client",
    ],
  },
  server: {
    warmup: { clientFiles: ["./src/main.tsx"] },
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": { target: process.env.API_URL ?? "http://localhost:8000", ws: true },
    },
  },
});
