import { Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useState } from "react";
import { api, type TrashItem } from "../api";
import { useApp } from "../context";
import { fmt } from "../time";

export function TrashPage() {
  const { user } = useApp();
  const qc = useQueryClient();
  const trash = useQuery({ queryKey: ["trash"], queryFn: () => api<TrashItem[]>("/trash") });
  const [confirm, setConfirm] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      notifications.show({ message: msg });
    } catch (e) {
      notifications.show({ color: "red", message: (e as Error).message });
    }
    qc.invalidateQueries();
  };

  return (
    <Stack gap="sm" maw={800}>
      <Title order={4}>Корзина</Title>
      <Text size="sm" c="dimmed">Заметки удаляются насовсем через 30 дней. При восстановлении вернутся напоминания, чей срок ещё не наступил.</Text>
      {trash.data?.length === 0 && <Text c="dimmed">Корзина пуста.</Text>}
      {trash.data?.map((n) => {
        const days = Math.max(0, Math.ceil(DateTime.fromISO(n.purge_at).diffNow("days").days));
        return (
          <Paper key={n.id} withBorder p="sm" radius="md">
            <Group justify="space-between" wrap="nowrap">
              <div style={{ minWidth: 0 }}>
                <Text fw={600} truncate>{n.title}</Text>
                <Text size="xs" c="dimmed">{fmt(n.start_at, user.timezone)} · удалится через {days} дн.</Text>
              </div>
              <Group gap="xs" wrap="nowrap">
                <Button size="xs" variant="light" onClick={() => act(() => api(`/trash/${n.id}/restore`, { method: "POST" }), "Заметка восстановлена")}>
                  Восстановить
                </Button>
                {confirm === n.id ? (
                  <Button size="xs" color="red" onClick={() => act(() => api(`/trash/${n.id}`, { method: "DELETE" }), "Удалено навсегда")}>
                    Точно удалить
                  </Button>
                ) : (
                  <Button size="xs" color="red" variant="subtle" onClick={() => setConfirm(n.id)}>Удалить навсегда</Button>
                )}
              </Group>
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );
}
