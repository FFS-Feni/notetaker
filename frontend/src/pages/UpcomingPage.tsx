import { ActionIcon, Badge, Button, Chip, Group, Paper, SimpleGrid, Stack, Text, Title, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";
import { api, occPath, type Note, type Occurrence, type Section, type Upcoming } from "../api";
import { ColorDot } from "../components/ColorPicker";
import { PageHeader } from "../components/PageHeader";
import { TaskCard } from "../components/TaskCard";
import { useApp } from "../context";
import { setFocus, todayIn } from "../priority";
import { fmt, ms } from "../time";

const SECTIONS: { key: Section; label: string; empty: string }[] = [
  { key: "focus", label: "★ Фокус дня", empty: "" },
  { key: "today", label: "Сегодня", empty: "На сегодня больше ничего." },
  { key: "tomorrow", label: "Завтра", empty: "На завтра пока пусто." },
  { key: "week", label: "На неделе", empty: "Дальше на неделе ничего." },
  { key: "past", label: "Прошедшие", empty: "Всё прошедшее отмечено. Отлично!" },
];

export function UpcomingPage() {
  const { user, openEditor } = useApp();
  const qc = useQueryClient();
  // Раз в минуту — сверка с сервером (на случай, если компьютер спал).
  const data = useQuery({ queryKey: ["upcoming"], queryFn: () => api<Upcoming>("/upcoming"), refetchInterval: 60_000 });
  const [now, setNow] = useState(Date.now());
  const shown = user.prefs.upcoming_sections.filter((s) => s !== "focus" || user.prefs.focus);
  const today_ = todayIn(user.timezone);
  const limit = user.prefs.focus_limit;

  const all = useMemo(() => {
    const seen = new Map<string, Occurrence>();
    for (const k of ["past", "today", "tomorrow", "week"] as const) for (const o of data.data?.[k] ?? []) seen.set(o.id, o);
    return [...seen.values()].sort((a, b) => ms(a.start) - ms(b.start));
  }, [data.data]);
  const day0 = DateTime.fromMillis(now).setZone(user.timezone).startOf("day");
  const endToday = day0.plus({ days: 1 }).toMillis();
  const endTomorrow = day0.plus({ days: 2 }).toMillis();
  const lists: Record<Exclude<Section, "focus">, Occurrence[]> = {
    today: all.filter((o) => ms(o.start) >= now && ms(o.start) < endToday),
    tomorrow: all.filter((o) => ms(o.start) >= endToday && ms(o.start) < endTomorrow),
    week: all.filter((o) => ms(o.start) >= endTomorrow),
    past: all.filter((o) => ms(o.start) < now && o.is_active).reverse(),
  };
  const focus = data.data?.focus ?? [];
  const focusIds = new Set(focus.map((n) => n.id));

  // Таймер на ближайшее время начала: в эту секунду заметка переезжает в «прошедшие» без обновления страницы.
  useEffect(() => {
    const next = Math.min(...all.map((o) => ms(o.start)).filter((t) => t > now), endToday);
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [all, now, endToday]);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      notifications.show({ color: "red", message: (e as Error).message });
    }
    qc.invalidateQueries();
  };
  const setSections = (v: string[]) =>
    run(() => api("/settings", { method: "PATCH", body: { prefs: { upcoming_sections: SECTIONS.map((s) => s.key).filter((k) => v.includes(k)) } } }));
  const toggleFocus = (id: string, version: number) => run(() => setFocus({ id, version }, focusIds.has(id) ? null : today_));
  // Вхождение повтора отмечаем отдельно, обычную заметку — целиком.
  const done = (o: Occurrence) =>
    run(() =>
      o.freq === "none"
        ? api(`/notes/${o.note_id}`, { method: "PATCH", body: { version: o.version, is_active: false } })
        : api(occPath(o), { method: "PATCH", params: { scope: "this" }, body: { version: o.version, is_active: false } }),
    );
  const recolor = (noteId: string, version: number, color: string | null) =>
    run(() => api(`/notes/${noteId}`, { method: "PATCH", body: { version, color } }));

  const occCard = (o: Occurrence, key: Section) => (
    <TaskCard
      key={o.id}
      task={o}
      when={fmt(o.start, user.timezone, key === "today" || key === "tomorrow" ? "HH:mm" : "ccc d MMM · HH:mm")}
      onClick={() => openEditor(o.freq === "none" ? { kind: "note", id: o.note_id } : { kind: "occ", occ: o })}
      actions={
        <>
          <ColorDot value={o.color} onChange={(c) => recolor(o.note_id, o.version, c)} />
          {user.prefs.focus && (
            <Tooltip label={focusIds.has(o.note_id) ? "Убрать из фокуса дня" : "В фокус дня"}>
              <ActionIcon variant="subtle" color="yellow" aria-label="Фокус дня" onClick={() => toggleFocus(o.note_id, o.version)}>
                {focusIds.has(o.note_id) ? "★" : "☆"}
              </ActionIcon>
            </Tooltip>
          )}
        </>
      }
      footer={key === "past" ? <Button size="compact-xs" variant="light" color="teal" onClick={() => done(o)}>✓ Готово</Button> : undefined}
    />
  );

  const columns = shown.filter((s): s is Exclude<Section, "focus"> => s !== "focus");
  return (
    <Stack gap="md">
      <PageHeader title="Ближайшее" hint={DateTime.fromMillis(now).setZone(user.timezone).setLocale("ru").toFormat("cccc, d MMMM")}>
        <Chip.Group multiple value={shown} onChange={setSections}>
          <Group gap={6}>
            {SECTIONS.filter((s) => s.key !== "focus" || user.prefs.focus).map((s) => (
              <Chip key={s.key} value={s.key} size="sm" variant="outline">
                {s.label}{s.key !== "focus" ? ` ${lists[s.key as Exclude<Section, "focus">].length}` : ` ${focus.length}/${limit}`}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
      </PageHeader>

      {shown.includes("focus") && (
        <Paper withBorder radius="lg" p="md" data-testid="focus" style={{ borderLeft: "5px solid var(--mantine-color-yellow-5)" }}>
          <Group justify="space-between" mb="xs">
            <Title order={4}>★ Фокус дня <Text span c="dimmed" size="sm">{focus.length} из {limit}</Text></Title>
            <Text size="xs" c="dimmed">Главные дела на сегодня — сделать в первую очередь</Text>
          </Group>
          {focus.length === 0 && <Text size="sm" c="dimmed">Нажмите ☆ у задачи ниже или на доске «Задачи», чтобы выбрать главное.</Text>}
          <SimpleGrid cols={{ base: 1, sm: Math.min(3, Math.max(1, focus.length)) }} spacing="sm">
            {focus.map((n: Note) => (
              <TaskCard
                key={n.id}
                task={n}
                when={fmt(n.start_at, user.timezone, "HH:mm")}
                onClick={() => openEditor({ kind: "note", id: n.id })}
                actions={
                  <>
                    <Button size="compact-xs" variant={n.is_active ? "light" : "default"} color="teal"
                      onClick={() => run(() => api(`/notes/${n.id}`, { method: "PATCH", body: { version: n.version, is_active: !n.is_active } }))}>
                      {n.is_active ? "✓ Готово" : "Вернуть"}
                    </Button>
                    <Button size="compact-xs" variant="subtle" color="gray" onClick={() => toggleFocus(n.id, n.version)}>Убрать</Button>
                  </>
                }
              />
            ))}
          </SimpleGrid>
        </Paper>
      )}

      {columns.length === 0 && !shown.includes("focus") && (
        <Paper withBorder p="xl" ta="center"><Text c="dimmed">Выберите вверху, что показывать.</Text></Paper>
      )}
      <SimpleGrid cols={{ base: 1, sm: Math.min(2, columns.length || 1), lg: Math.min(4, columns.length || 1) }} spacing="md">
        {columns.map((key) => {
          const s = SECTIONS.find((x) => x.key === key)!;
          const list = lists[key];
          return (
            <Stack key={key} gap={8} data-testid={`column-${s.label}`}>
              <Group gap={8}>
                <Title order={4}>{s.label}</Title>
                <Badge variant="light" color={key === "past" && list.length ? "orange" : "gray"}>{list.length}</Badge>
              </Group>
              {list.length === 0 && <Text size="sm" c="dimmed">{s.empty}</Text>}
              {list.map((o) => occCard(o, key))}
            </Stack>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}
