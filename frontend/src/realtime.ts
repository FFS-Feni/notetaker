import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { AppNotification } from "./api";

// Какие данные перезапросить по событию с сервера.
const AFFECTS: Record<string, string[]> = {
  notes: ["notes", "note", "occurrences", "upcoming", "trash"],
  tags: ["tags", "notes", "note", "occurrences", "upcoming", "trash"],
  settings: ["me", "occurrences", "upcoming"],
  notification: ["notifications"],
  notification_shown: ["notifications"],
};

export function useRealtime(onNotification: (n: AppNotification) => void) {
  const qc = useQueryClient();
  const [online, setOnline] = useState(false);
  const notify = useRef(onNotification);
  notify.current = onNotification;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let attempt = 0;
    let wasOpen = false;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`);
      ws.onopen = () => {
        // Пока связи не было, события могли потеряться — перезапрашиваем всё.
        if (wasOpen) qc.invalidateQueries();
        wasOpen = true;
        attempt = 0;
        setOnline(true);
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        const keys = AFFECTS[msg.type] ?? [];
        qc.invalidateQueries({ predicate: (q) => keys.includes(q.queryKey[0] as string) });
        if (msg.type === "notification") notify.current(msg);
      };
      ws.onclose = () => {
        setOnline(false);
        if (!stopped) setTimeout(connect, Math.min(10_000, 500 * 2 ** attempt++));
      };
    };
    connect();
    const ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
    return () => {
      stopped = true;
      clearInterval(ping);
      ws?.close();
    };
  }, [qc]);

  return online;
}
