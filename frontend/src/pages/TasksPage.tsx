import { ActionIcon, Badge, Grid, Group, Loader, Menu, Paper, ScrollArea, SimpleGrid, Stack, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api, type Matrix, type Note, type NotePage } from "../api";
import { ColorDot, ColorPicker } from "../components/ColorPicker";
import { PageHeader } from "../components/PageHeader";
import { TaskCard } from "../components/TaskCard";
import { useApp } from "../context";
import { QUADRANTS, setFocus, todayIn } from "../priority";
import { fmt } from "../time";

type Target = "inbox" | (typeof QUADRANTS)[number]["key"];
const PLACE: Record<Target, { triaged: boolean; important: boolean; urgent: boolean }> = {
  inbox: { triaged: false, important: false, urgent: false },
  do: { triaged: true, important: true, urgent: true },
  plan: { triaged: true, important: true, urgent: false },
  delegate: { triaged: true, important: false, urgent: true },
  drop: { triaged: true, important: false, urgent: false },
};
const placeOf = (n: Note): Target =>
  !n.triaged ? "inbox" : n.important ? (n.urgent ? "do" : "plan") : n.urgent ? "delegate" : "drop";

function DropZone({ id, over, setOver, onDrop, children, color, testId }: {
  id: Target; over: Target | null; setOver: (t: Target | null) => void; onDrop: (id: string, t: Target) => void;
  children: ReactNode; color: string; testId: string;
}) {
  return (
    <Paper
      withBorder
      radius="lg"
      p="sm"
      data-testid={testId}
      onDragOver={(e) => { e.preventDefault(); setOver(id); }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => { e.preventDefault(); setOver(null); onDrop(e.dataTransfer.getData("text/plain"), id); }}
      style={{
        height: "100%",
        transition: "background 120ms, border-color 120ms",
        borderColor: over === id ? `var(--mantine-color-${color}-5)` : undefined,
        background: over === id ? `var(--mantine-color-${color}-light)` : undefined,
      }}
    >
      {children}
    </Paper>
  );
}

export function TasksPage() {
  const { user, openEditor } = useApp();
  const qc = useQueryClient();
  const [over, setOver] = useState<Target | null>(null);
  const [q, setQ] = useState("");
  const [query] = useDebouncedValue(q, 300);
  const [color, setColor] = useState<string | null>(null);
  const today = todayIn(user.timezone);

  // Неразобранные: все активные задачи, которые ещё не положили ни в один блок (поиск и цвет — на сервере).
  const inbox = useInfiniteQuery({
    queryKey: ["notes", "inbox", query, color],
    queryFn: ({ pageParam }) => api<NotePage>("/notes", { params: { status: "active", triaged: false, q: query, color: color ?? undefined, cursor: pageParam, limit: 50 } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const board = useQuery({ queryKey: ["matrix"], queryFn: () => api<Matrix>("/matrix", { params: { limit: 100 } }) });
  const inboxItems = inbox.data?.pages.flatMap((p) => p.items) ?? [];
  const all = [...inboxItems, ...QUADRANTS.flatMap((x) => board.data?.[x.key].items ?? [])];

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      notifications.show({ color: "red", message: (e as Error).message });
    }
    qc.invalidateQueries();
  };
  const patch = (n: Note, body: object) => run(() => api(`/notes/${n.id}`, { method: "PATCH", body: { version: n.version, ...body } }));
  const move = (n: Note, t: Target) => placeOf(n) !== t && patch(n, PLACE[t]);
  const drop = (id: string, t: Target) => {
    const n = all.find((x) => x.id === id);
    if (n) move(n, t);
  };

  const card = (n: Note) => (
    <TaskCard
      key={n.id}
      testId="task-card"
      task={n}
      dense
      draggableId={n.id}
      when={fmt(n.start_at, user.timezone, "d MMM, HH:mm")}
      onClick={() => openEditor({ kind: "note", id: n.id })}
      actions={
        <>
          <ColorDot value={n.color} onChange={(c) => patch(n, { color: c })} />
          {user.prefs.focus && (
            <Tooltip label={n.focus_on === today ? "Убрать из фокуса дня" : "В фокус дня"}>
              <ActionIcon variant="subtle" color="yellow" aria-label="Фокус дня" onClick={() => run(() => setFocus(n, n.focus_on === today ? null : today))}>
                {n.focus_on === today ? "★" : "☆"}
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label="Готово — убрать с доски">
            <ActionIcon variant="subtle" color="teal" aria-label="Готово" onClick={() => patch(n, { is_active: false })}>✓</ActionIcon>
          </Tooltip>
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label="Переместить">⋯</ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Переместить в</Menu.Label>
              {placeOf(n) !== "inbox" && <Menu.Item onClick={() => move(n, "inbox")}>Неразобранные</Menu.Item>}
              {QUADRANTS.filter((x) => x.key !== placeOf(n)).map((x) => (
                <Menu.Item key={x.key} onClick={() => move(n, x.key)}>{x.title}</Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        </>
      }
    />
  );

  const inboxTotal = inbox.data?.pages[0]?.total ?? 0;
  return (
    <Stack gap="sm">
      <PageHeader title="Задачи" hint="Все активные задачи. Перетащите задачу из «Неразобранных» в нужный блок — так видно, что делать сейчас, что запланировать, что поручить" />
      <Grid gap="md" align="stretch">
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <DropZone id="inbox" over={over} setOver={setOver} onDrop={drop} color="gray" testId="inbox">
            <Group justify="space-between" mb={6}>
              <Title order={4}>Неразобранные</Title>
              <Badge variant="light" color="gray" size="lg">{inboxTotal}</Badge>
            </Group>
            <TextInput placeholder="Найти задачу…" value={q} onChange={(e) => setQ(e.currentTarget.value)} mb={6} size="sm" />
            <Group mb="xs" gap={6}>
              <Text size="xs" c="dimmed">Цвет:</Text>
              <ColorPicker value={color} onChange={setColor} />
            </Group>
            <ScrollArea.Autosize mah="calc(100vh - 330px)" type="auto" offsetScrollbars
              onBottomReached={() => inbox.hasNextPage && !inbox.isFetchingNextPage && inbox.fetchNextPage()}>
              <Stack gap={6}>
                {inboxItems.map(card)}
                {inbox.isFetchingNextPage && <Loader size="sm" mx="auto" />}
                {!inbox.isPending && inboxItems.length === 0 && (
                  <Text size="sm" c="dimmed" ta="center" py="lg">Всё разобрано. Новые задачи появятся здесь.</Text>
                )}
              </Stack>
            </ScrollArea.Autosize>
          </DropZone>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            {QUADRANTS.map((x) => {
              const quad = board.data?.[x.key];
              return (
                <DropZone key={x.key} id={x.key} over={over} setOver={setOver} onDrop={drop} color={x.color} testId={`quadrant-${x.key}`}>
                  <Group justify="space-between" wrap="nowrap" mb={2}>
                    <Group gap={8} wrap="nowrap">
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: `var(--mantine-color-${x.color}-6)` }} />
                      <Title order={5}>{x.title}</Title>
                    </Group>
                    <Badge variant="light" color={x.color}>{quad?.total ?? 0}</Badge>
                  </Group>
                  <Text size="xs" c="dimmed" mb="xs">{x.hint}</Text>
                  <ScrollArea.Autosize mah={300} type="auto" offsetScrollbars>
                    <Stack gap={6} mih={90}>
                      {quad?.items.map(card)}
                      {quad?.total === 0 && (
                        <Text size="sm" c="dimmed" ta="center" py="md" style={{ border: "1.5px dashed var(--mantine-color-default-border)", borderRadius: 8 }}>
                          Перетащите сюда задачу
                        </Text>
                      )}
                    </Stack>
                  </ScrollArea.Autosize>
                </DropZone>
              );
            })}
          </SimpleGrid>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
