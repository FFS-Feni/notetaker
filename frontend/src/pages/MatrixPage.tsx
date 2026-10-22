import { ActionIcon, Badge, Group, Menu, Paper, SimpleGrid, Stack, Text, Title, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Matrix, type Note } from "../api";
import { useApp } from "../context";
import { QUADRANTS, setFocus, todayIn } from "../priority";
import { fmt } from "../time";

type Q = (typeof QUADRANTS)[number];

export function MatrixPage() {
  const { user, openEditor } = useApp();
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ["matrix"], queryFn: () => api<Matrix>("/matrix") });
  const [over, setOver] = useState<string | null>(null);
  const today = todayIn(user.timezone);
  const all = QUADRANTS.flatMap((q) => data.data?.[q.key].items ?? []);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      notifications.show({ color: "red", message: (e as Error).message });
    }
    qc.invalidateQueries();
  };
  const move = (n: Note, q: Q) =>
    (n.important !== q.important || n.urgent !== q.urgent) &&
    run(() => api(`/notes/${n.id}`, { method: "PATCH", body: { version: n.version, important: q.important, urgent: q.urgent } }));
  const focus = (n: Note) => run(() => setFocus(n, n.focus_on === today ? null : today));

  return (
    <Stack gap="sm">
      <div>
        <Title order={4}>Матрица Эйзенхауэра</Title>
        <Text size="sm" c="dimmed">
          Перетащите заметку в нужный квадрант или выберите его в меню ⋯. {user.prefs.focus ? `★ — добавить в «Фокус дня» (до ${user.prefs.focus_limit} главных дел). ` : ""}Сделанные (неактивные) заметки здесь не показываются.
        </Text>
      </div>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        {QUADRANTS.map((q) => {
          const quad = data.data?.[q.key];
          return (
            <Paper
              key={q.key}
              data-testid={`quadrant-${q.key}`}
              withBorder
              radius="md"
              p="sm"
              style={{
                minHeight: 220,
                borderTop: `4px solid var(--mantine-color-${q.color}-6)`,
                background: over === q.key ? `var(--mantine-color-${q.color}-light)` : undefined,
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(q.key);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const n = all.find((x) => x.id === e.dataTransfer.getData("text/plain"));
                if (n) move(n, q);
              }}
            >
              <Group justify="space-between" mb={4} wrap="nowrap">
                <Title order={5}>{q.title}</Title>
                <Badge color={q.color} variant="light">{quad?.total ?? 0}</Badge>
              </Group>
              <Text size="xs" c="dimmed" mb="xs">{q.hint}</Text>
              <Stack gap={6}>
                {quad?.items.map((n) => (
                  <Paper
                    key={n.id}
                    withBorder
                    p={6}
                    radius="sm"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", n.id)}
                    style={{ cursor: "grab" }}
                    onClick={() => openEditor({ kind: "note", id: n.id })}
                  >
                    <Group justify="space-between" wrap="nowrap" gap={4}>
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" fw={600} truncate>{n.title}</Text>
                        <Group gap={4} wrap="nowrap">
                          <Text size="xs" c="dimmed">{fmt(n.start_at, user.timezone, "dd.MM HH:mm")}{n.freq !== "none" ? " · ↻" : ""}</Text>
                          {n.tags.slice(0, 2).map((t) => <Badge key={t.id} size="xs" variant="light" color={t.color}>{t.name}</Badge>)}
                        </Group>
                      </div>
                      <Group gap={2} wrap="nowrap" onClick={(e) => e.stopPropagation()}>
                        {user.prefs.focus && <Tooltip label={n.focus_on === today ? "Убрать из фокуса дня" : "В фокус дня"}>
                          <ActionIcon variant="subtle" color="yellow" aria-label="Фокус дня" onClick={() => focus(n)}>
                            {n.focus_on === today ? "★" : "☆"}
                          </ActionIcon>
                        </Tooltip>}
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="gray" aria-label="Переместить">⋯</ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Label>Переместить в</Menu.Label>
                            {QUADRANTS.filter((t) => t.key !== q.key).map((t) => (
                              <Menu.Item key={t.key} onClick={() => move(n, t)}>{t.title}</Menu.Item>
                            ))}
                          </Menu.Dropdown>
                        </Menu>
                      </Group>
                    </Group>
                  </Paper>
                ))}
                {quad && quad.total > quad.items.length && (
                  <Text size="xs" c="dimmed">Показаны {quad.items.length} из {quad.total} — остальные в «Списке» с фильтром приоритета.</Text>
                )}
                {quad?.total === 0 && <Text size="sm" c="dimmed">Пусто — перетащите сюда заметку.</Text>}
              </Stack>
            </Paper>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}
