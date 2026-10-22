import { Badge, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";
import { api, occPath, type Occurrence, type Upcoming } from "../api";
import { useApp } from "../context";
import { fmt, ms } from "../time";

export function UpcomingPage() {
  const { user, openEditor } = useApp();
  const qc = useQueryClient();
  // Раз в минуту — сверка с сервером (на случай, если компьютер спал).
  const data = useQuery({ queryKey: ["upcoming"], queryFn: () => api<Upcoming>("/upcoming"), refetchInterval: 60_000 });
  const [now, setNow] = useState(Date.now());

  const all = useMemo(() => {
    const seen = new Map<string, Occurrence>();
    for (const o of [...(data.data?.past ?? []), ...(data.data?.today ?? []), ...(data.data?.week ?? [])]) seen.set(o.id, o);
    return [...seen.values()].sort((a, b) => ms(a.start) - ms(b.start));
  }, [data.data]);
  const endToday = DateTime.fromMillis(now).setZone(user.timezone).startOf("day").plus({ days: 1 }).toMillis();
  const today = all.filter((o) => ms(o.start) >= now && ms(o.start) < endToday);
  const week = all.filter((o) => ms(o.start) >= endToday);
  const past = all.filter((o) => ms(o.start) < now && o.is_active).reverse();

  // Таймер на ближайшее время начала: в эту секунду заметка переезжает в «прошедшие» без обновления страницы.
  useEffect(() => {
    const next = Math.min(...all.map((o) => ms(o.start)).filter((t) => t > now), endToday);
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [all, now, endToday]);

  const deactivate = async (o: Occurrence) => {
    try {
      if (o.freq === "none") await api(`/notes/${o.note_id}`, { method: "PATCH", body: { version: o.version, is_active: false } });
      else await api(occPath(o), { method: "PATCH", params: { scope: "this" }, body: { version: o.version, is_active: false } });
    } catch (e) {
      notifications.show({ color: "red", message: (e as Error).message });
    }
    qc.invalidateQueries();
  };

  const column = (title: string, list: Occurrence[], empty: string, isPast = false) => (
    <Stack gap="xs">
      <Title order={5}>{title} <Text span c="dimmed" size="sm">{list.length}</Text></Title>
      {list.length === 0 && <Text size="sm" c="dimmed">{empty}</Text>}
      {list.map((o) => (
        <Paper key={o.id} withBorder p="xs" radius="md" style={{ opacity: o.is_active ? 1 : 0.55, cursor: "pointer" }}
          onClick={() => openEditor(o.freq === "none" ? { kind: "note", id: o.note_id } : { kind: "occ", occ: o })}>
          <Text size="xs" c="dimmed">{fmt(o.start, user.timezone, isPast || title === "На неделе" ? "ccc, d MMM · HH:mm" : "HH:mm")}{o.freq !== "none" ? " · ↻" : ""}{o.is_active ? "" : " · неактивна"}</Text>
          <Text fw={600}>{o.title}</Text>
          <Group gap={4} mt={2}>
            {o.tags.map((t) => <Badge key={t.id} size="xs" variant="light" color={t.color}>{t.name}</Badge>)}
          </Group>
          {isPast && (
            <Button size="xs" variant="light" mt={6} onClick={(e) => { e.stopPropagation(); deactivate(o); }}>
              Сделать неактивной
            </Button>
          )}
        </Paper>
      ))}
    </Stack>
  );

  return (
    <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
      {column("Сегодня", today, "На сегодня больше ничего.")}
      {column("На неделе", week, "На ближайшие 7 дней ничего.")}
      {column("Прошедшие активные", past, "Всё прошедшее отмечено. Отлично!", true)}
    </SimpleGrid>
  );
}
