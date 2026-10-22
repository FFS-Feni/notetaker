import { Button, Group, MultiSelect, Paper, SegmentedControl, Select, Stack, Switch, Text, TextInput, Tooltip, UnstyledButton } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { DateTime } from "luxon";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { api, type Note, type NotePage, type Tag } from "../api";
import { PALETTE, colorLabel } from "../colors";
import { ColorDot } from "../components/ColorPicker";
import { PageHeader } from "../components/PageHeader";
import { TaskCard } from "../components/TaskCard";
import { useApp } from "../context";
import { QUADRANTS } from "../priority";
import { FREQ_LABEL, fmt } from "../time";

const SORTS = {
  start_asc: ["start", "asc", "Сначала ранние"],
  start_desc: ["start", "desc", "Сначала поздние"],
  updated_desc: ["updated", "desc", "Изменены недавно"],
  updated_asc: ["updated", "asc", "Изменены давно"],
} as const;

// Фильтр по цветам: нажатые кружки — показываются только задачи этих цветов.
function ColorFilter({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { user } = useApp();
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <Group gap={6}>
      {PALETTE.map((c) => (
        <Tooltip key={c.key} label={colorLabel(user, c.key)}>
          <UnstyledButton aria-label={colorLabel(user, c.key)} aria-pressed={value.includes(c.key)} onClick={() => toggle(c.key)}
            style={{ width: 22, height: 22, borderRadius: "50%", background: c.hex, opacity: value.length && !value.includes(c.key) ? 0.3 : 1,
              outline: value.includes(c.key) ? "2px solid var(--mantine-color-text)" : "none", outlineOffset: 2 }} />
        </Tooltip>
      ))}
    </Group>
  );
}

export function NotesPage() {
  const { user, openEditor } = useApp();
  const qc = useQueryClient();
  const [search] = useSearchParams();
  const [q, setQ] = useState("");
  const [query] = useDebouncedValue(q, 300);
  const [tagIds, setTagIds] = useState<string[]>(search.get("tag") ? [search.get("tag")!] : []);
  const [colors, setColors] = useState<string[]>([]);
  const [status, setStatus] = useState("all");
  const [period, setPeriod] = useState<[string | null, string | null]>([null, null]);
  const [sort, setSort] = useState<keyof typeof SORTS>("start_asc");
  const [quadrant, setQuadrant] = useState<string | null>(null);
  const quad = QUADRANTS.find((x) => x.key === quadrant);
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api<Tag[]>("/tags") });

  const day = (d: string | null, plus = 0) => (d ? DateTime.fromISO(d, { zone: user.timezone }).plus({ days: plus }).toISO() : undefined);
  const params = {
    q: query,
    tags: tagIds.join(","),
    color: colors.join(","),
    status,
    from: day(period[0]),
    to: period[1] ? day(period[1], 1) : undefined,
    sort: SORTS[sort][0],
    order: SORTS[sort][1],
    important: user.prefs.priorities ? quad?.important : undefined,
    urgent: user.prefs.priorities ? quad?.urgent : undefined,
    triaged: user.prefs.priorities && quad ? true : undefined,
  };
  const filtered = !!(q || tagIds.length || colors.length || status !== "all" || period[0] || quadrant);
  const reset = () => { setQ(""); setTagIds([]); setColors([]); setStatus("all"); setPeriod([null, null]); setQuadrant(null); };

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
  const rows = useVirtualizer({ count: items.length, getScrollElement: () => scrollRef.current, estimateSize: () => 84, overscan: 12 });
  const virtual = rows.getVirtualItems();
  useEffect(() => {
    const last = virtual[virtual.length - 1];
    if (last && last.index >= items.length - 10 && notes.hasNextPage && !notes.isFetchingNextPage) notes.fetchNextPage();
  }, [virtual, items.length, notes]);

  const patch = async (n: Note, body: object) => {
    try {
      await api(`/notes/${n.id}`, { method: "PATCH", body: { version: n.version, ...body } });
    } catch (e) {
      notifications.show({ color: "red", message: (e as Error).message });
    }
    qc.invalidateQueries();
  };

  return (
    <Stack gap="sm">
      <PageHeader title="Список" hint="Все заметки. Поиск и фильтры работают по всем заметкам на сервере" />
      <Paper withBorder radius="lg" p="sm" mt={-8}>
        <Stack gap="xs">
          <Group gap="sm" align="flex-end" wrap="wrap">
            <TextInput label="Поиск" placeholder="в заголовке и тексте" value={q} onChange={(e) => setQ(e.currentTarget.value)} w={{ base: "100%", sm: 260 }} />
            <MultiSelect label="Теги" placeholder="любые" data={(tags.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))} value={tagIds} onChange={setTagIds} w={{ base: "100%", sm: 220 }} clearable />
            {user.prefs.priorities && <Select label="Блок на доске" placeholder="любой" clearable value={quadrant} onChange={setQuadrant}
              data={QUADRANTS.map((x) => ({ value: x.key, label: x.title }))} w={{ base: "100%", sm: 210 }} />}
            <DatePickerInput type="range" label="Период" placeholder="за всё время" value={period} onChange={(v) => setPeriod(v as [string | null, string | null])} clearable valueFormat="DD.MM.YYYY" w={{ base: "100%", sm: 220 }} />
            <Select label="Порядок" value={sort} onChange={(v) => v && setSort(v as keyof typeof SORTS)} data={Object.entries(SORTS).map(([value, s]) => ({ value, label: s[2] }))} w={{ base: "100%", sm: 180 }} allowDeselect={false} />
          </Group>
          <Group gap="lg" wrap="wrap">
            <Group gap={8}><Text size="sm" fw={500}>Цвет</Text><ColorFilter value={colors} onChange={setColors} /></Group>
            <SegmentedControl size="xs" value={status} onChange={setStatus} data={[{ value: "all", label: "Все" }, { value: "active", label: "Активные" }, { value: "inactive", label: "Сделанные" }]} />
            {filtered && <Button size="compact-sm" variant="subtle" onClick={reset}>Сбросить фильтры</Button>}
          </Group>
        </Stack>
      </Paper>
      <Text size="sm" c="dimmed">Найдено: {total}{notes.isFetching ? " · загрузка…" : ""}</Text>
      <div ref={scrollRef} style={{ height: "calc(100vh - 330px)", minHeight: 320, overflow: "auto" }}>
        <div style={{ height: rows.getTotalSize(), position: "relative" }}>
          {virtual.map((v) => {
            const n = items[v.index];
            return (
              <div key={n.id} ref={rows.measureElement} data-index={v.index}
                style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${v.start}px)`, paddingBottom: 6 }}>
                <TaskCard
                  task={n}
                  when={fmt(n.start_at, user.timezone, "ccc d MMM yyyy · HH:mm") + (n.freq !== "none" ? ` · ${FREQ_LABEL[n.freq].toLowerCase()}` : "")}
                  onClick={() => openEditor({ kind: "note", id: n.id })}
                  onChecklist={(items) => patch(n, { checklist: items })}
                  actions={
                    <>
                      <ColorDot value={n.color} onChange={(c) => patch(n, { color: c })} />
                      <Tooltip label={n.is_active ? "Активна — нажмите, когда сделано" : "Сделано — вернуть в работу"}>
                        <Switch checked={n.is_active} onChange={(e) => patch(n, { is_active: e.currentTarget.checked })} aria-label="Активна" />
                      </Tooltip>
                    </>
                  }
                />
              </div>
            );
          })}
        </div>
        {!notes.isPending && items.length === 0 && <Text c="dimmed" ta="center" mt="xl">Ничего не найдено. Измените фильтры или создайте заметку (клавиша N).</Text>}
      </div>
    </Stack>
  );
}
