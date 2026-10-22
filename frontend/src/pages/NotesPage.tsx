import { Badge, Group, MultiSelect, Paper, SegmentedControl, Select, Stack, Switch, Text, TextInput, Button } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { DateTime } from "luxon";
import { useEffect, useRef, useState } from "react";
import { api, type Note, type NotePage, type Tag } from "../api";
import { useApp } from "../context";
import { FREQ_LABEL, fmt } from "../time";

const SORTS = {
  start_asc: ["start", "asc", "Дата заметки ↑"],
  start_desc: ["start", "desc", "Дата заметки ↓"],
  updated_desc: ["updated", "desc", "Изменены недавно"],
  updated_asc: ["updated", "asc", "Изменены давно"],
} as const;

export function NotesPage() {
  const { user, openEditor } = useApp();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [query] = useDebouncedValue(q, 300);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [status, setStatus] = useState("all");
  const [period, setPeriod] = useState<[string | null, string | null]>([null, null]);
  const [sort, setSort] = useState<keyof typeof SORTS>("start_asc");
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api<Tag[]>("/tags") });

  const day = (d: string | null, plus = 0) => (d ? DateTime.fromISO(d, { zone: user.timezone }).plus({ days: plus }).toISO() : undefined);
  const params = {
    q: query,
    tags: tagIds.join(","),
    status,
    from: day(period[0]),
    to: period[1] ? day(period[1], 1) : undefined,
    sort: SORTS[sort][0],
    order: SORTS[sort][1],
  };
  // Поиск и фильтры — на сервере по всем заметкам; страницы по 50 через курсор.
  const notes = useInfiniteQuery({
    queryKey: ["notes", params],
    queryFn: ({ pageParam }) => api<NotePage>("/notes", { params: { ...params, cursor: pageParam, limit: 50 } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const items = notes.data?.pages.flatMap((p) => p.items) ?? [];
  const total = notes.data?.pages[0]?.total ?? 0;

  // В DOM — только видимые строки: тысячи заметок листаются без задержек.
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useVirtualizer({ count: items.length, getScrollElement: () => scrollRef.current, estimateSize: () => 68, overscan: 12 });
  const virtual = rows.getVirtualItems();
  useEffect(() => {
    const last = virtual[virtual.length - 1];
    if (last && last.index >= items.length - 10 && notes.hasNextPage && !notes.isFetchingNextPage) notes.fetchNextPage();
  }, [virtual, items.length, notes]);

  const toggle = async (n: Note, is_active: boolean) => {
    try {
      await api(`/notes/${n.id}`, { method: "PATCH", body: { version: n.version, is_active } });
    } catch (e) {
      notifications.show({ color: "red", message: (e as Error).message });
    }
    qc.invalidateQueries();
  };

  return (
    <Stack gap="sm">
      <Group gap="sm" align="flex-end" wrap="wrap">
        <TextInput label="Поиск по заголовку и тексту" placeholder="например, банк" value={q} onChange={(e) => setQ(e.currentTarget.value)} w={{ base: "100%", sm: 240 }} />
        <MultiSelect label="Теги" placeholder="любые" data={(tags.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))} value={tagIds} onChange={setTagIds} w={{ base: "100%", sm: 220 }} clearable />
        <div>
          <Text size="sm" fw={500} mb={2}>Статус</Text>
          <SegmentedControl value={status} onChange={setStatus} data={[{ value: "all", label: "Все" }, { value: "active", label: "Активные" }, { value: "inactive", label: "Неактивные" }]} />
        </div>
        <DatePickerInput type="range" label="Период" placeholder="за всё время" value={period} onChange={(v) => setPeriod(v as [string | null, string | null])} clearable valueFormat="DD.MM.YYYY" w={{ base: "100%", sm: 230 }} />
        <Select label="Сортировка" value={sort} onChange={(v) => v && setSort(v as keyof typeof SORTS)} data={Object.entries(SORTS).map(([value, s]) => ({ value, label: s[2] }))} w={{ base: "100%", sm: 190 }} allowDeselect={false} />
        <Button onClick={() => openEditor({ kind: "new" })}>Новая заметка</Button>
      </Group>
      <Text size="sm" c="dimmed">Найдено: {total}{notes.isFetching ? " · загрузка…" : ""}</Text>
      <div ref={scrollRef} style={{ height: "calc(100vh - 250px)", minHeight: 300, overflow: "auto" }}>
        <div style={{ height: rows.getTotalSize(), position: "relative" }}>
          {virtual.map((v) => {
            const n = items[v.index];
            return (
              <div key={n.id} style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${v.start}px)`, paddingBottom: 6 }}>
                <Paper withBorder p="xs" radius="md" style={{ cursor: "pointer", opacity: n.is_active ? 1 : 0.6 }} onClick={() => openEditor({ kind: "note", id: n.id })}>
                  <Group justify="space-between" wrap="nowrap">
                    <div style={{ minWidth: 0 }}>
                      <Text fw={600} truncate>{n.title}</Text>
                      <Group gap={6} wrap="nowrap">
                        <Text size="xs" c="dimmed">{fmt(n.start_at, user.timezone)}{n.freq !== "none" ? ` · ↻ ${FREQ_LABEL[n.freq].toLowerCase()}` : ""}</Text>
                        {n.tags.map((t) => (
                          <Badge key={t.id} size="xs" variant="light" color={t.color}>{t.name}</Badge>
                        ))}
                      </Group>
                    </div>
                    <Switch checked={n.is_active} onClick={(e) => e.stopPropagation()} onChange={(e) => toggle(n, e.currentTarget.checked)} aria-label="Активна" />
                  </Group>
                </Paper>
              </div>
            );
          })}
        </div>
        {!notes.isPending && items.length === 0 && <Text c="dimmed" ta="center" mt="xl">Ничего не найдено. Измените фильтры или создайте заметку.</Text>}
      </div>
    </Stack>
  );
}
