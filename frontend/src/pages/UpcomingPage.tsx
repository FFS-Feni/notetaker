import { ActionIcon, Badge, Button, Group, Paper, SimpleGrid, Stack, Text, Title, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";
import { api, occPath, type Note, type Occurrence, type Upcoming } from "../api";
import { setFocus, todayIn } from "../priority";
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

  const today_ = todayIn(user.timezone);
  const focus = data.data?.focus ?? [];
  const focusIds = new Set(focus.map((n) => n.id));
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      notifications.show({ color: "red", message: (e as Error).message });
    }
    qc.invalidateQueries();
  };
  const toggleFocus = (n: { note_id?: string; id: string; version: number }) => {
    const id = n.note_id ?? n.id;
    return run(() => setFocus({ id, version: n.version }, focusIds.has(id) ? null : today_));
  };
  const done = (n: Note) => run(() => api(`/notes/${n.id}`, { method: "PATCH", body: { version: n.version, is_active: !n.is_active } }));

  const column = (title: string, list: Occurrence[], empty: string, isPast = false) => (
    <Stack gap="xs" data-testid={`column-${title}`}>
      <Title order={5}>{title} <Text span c="dimmed" size="sm">{list.length}</Text></Title>
      {list.length === 0 && <Text size="sm" c="dimmed">{empty}</Text>}
      {list.map((o) => (
        <Paper key={o.id} withBorder p="xs" radius="md" style={{ opacity: o.is_active ? 1 : 0.55, cursor: "pointer" }}
          onClick={() => openEditor(o.freq === "none" ? { kind: "note", id: o.note_id } : { kind: "occ", occ: o })}>
          <Text size="xs" c="dimmed">{fmt(o.start, user.timezone, isPast || title === "На неделе" ? "ccc, d MMM · HH:mm" : "HH:mm")}{o.freq !== "none" ? " · ↻" : ""}{o.is_active ? "" : " · неактивна"}</Text>
          <Group justify="space-between" wrap="nowrap" gap={4}>
            <Text fw={600}>{o.important ? "❗ " : ""}{o.title}</Text>
            <Tooltip label={focusIds.has(o.note_id) ? "Убрать из фокуса дня" : "В фокус дня"}>
              <ActionIcon variant="subtle" color="yellow" aria-label="Фокус дня" onClick={(e) => { e.stopPropagation(); toggleFocus(o); }}>
                {focusIds.has(o.note_id) ? "★" : "☆"}
              </ActionIcon>
            </Tooltip>
          </Group>
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
    <Stack gap="lg">
    <Paper withBorder radius="md" p="sm" data-testid="focus" style={{ borderLeft: "4px solid var(--mantine-color-yellow-5)" }}>
      <Group justify="space-between" mb={6}>
        <Title order={5}>★ Фокус дня <Text span c="dimmed" size="sm">{focus.length} из 3</Text></Title>
        <Text size="xs" c="dimmed">Три главных дела на сегодня — сделать их в первую очередь</Text>
      </Group>
      {focus.length === 0 && <Text size="sm" c="dimmed">Нажмите ☆ у заметки ниже или в «Матрице», чтобы выбрать главное на сегодня.</Text>}
      <Stack gap={6}>
        {focus.map((n) => (
          <Group key={n.id} justify="space-between" wrap="nowrap">
            <Text fw={600} td={n.is_active ? undefined : "line-through"} c={n.is_active ? undefined : "dimmed"} style={{ cursor: "pointer" }}
              onClick={() => openEditor({ kind: "note", id: n.id })}>
              {n.important ? "❗ " : ""}{n.title} <Text span size="xs" c="dimmed">· {fmt(n.start_at, user.timezone, "HH:mm")}</Text>
            </Text>
            <Group gap={6} wrap="nowrap">
              <Button size="xs" variant={n.is_active ? "light" : "default"} color="teal" onClick={() => done(n)}>{n.is_active ? "Готово" : "Вернуть"}</Button>
              <Button size="xs" variant="subtle" color="gray" onClick={() => toggleFocus(n)}>Убрать</Button>
            </Group>
          </Group>
        ))}
      </Stack>
    </Paper>
    <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
      {column("Сегодня", today, "На сегодня больше ничего.")}
      {column("На неделе", week, "На ближайшие 7 дней ничего.")}
      {column("Прошедшие активные", past, "Всё прошедшее отмечено. Отлично!", true)}
    </SimpleGrid>
    </Stack>
  );
}
