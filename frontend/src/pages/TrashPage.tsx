import { Badge, Button, Group, MultiSelect, Paper, Stack, Text, TextInput } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useState } from "react";
import { api, type Tag, type TrashItem } from "../api";
import { PALETTE, colorLabel } from "../colors";
import { PageHeader } from "../components/PageHeader";
import { TaskCard } from "../components/TaskCard";
import { useApp } from "../context";
import { QUADRANTS } from "../priority";
import { FREQ_LABEL, fmt } from "../time";

// Где была заметка до удаления: блок на доске, фокус дня, повтор.
function wasIn(n: TrashItem): string[] {
  const out: string[] = [];
  if (n.triaged) out.push(QUADRANTS.find((q) => q.important === n.important && q.urgent === n.urgent)?.title ?? "Доска");
  else if (n.is_active) out.push("Неразобранные");
  if (!n.is_active) out.push("Сделана");
  if (n.focus_on) out.push(`Фокус дня ${DateTime.fromISO(n.focus_on).toFormat("dd.MM")}`);
  if (n.freq !== "none") out.push(FREQ_LABEL[n.freq as keyof typeof FREQ_LABEL]);
  return out;
}

export function TrashPage() {
  const { user } = useApp();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [query] = useDebouncedValue(q, 300);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [period, setPeriod] = useState<[string | null, string | null]>([null, null]);
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api<Tag[]>("/tags") });
  const day = (d: string | null, plus = 0) => (d ? DateTime.fromISO(d, { zone: user.timezone }).plus({ days: plus }).toISO() : undefined);
  const params = {
    q: query, tags: tagIds.join(","), color: colors.join(","),
    deleted_from: day(period[0]), deleted_to: period[1] ? day(period[1], 1) : undefined,
  };
  const trash = useQuery({ queryKey: ["trash", params], queryFn: () => api<TrashItem[]>("/trash", { params }) });
  const [confirm, setConfirm] = useState<string | null>(null);
  const filtered = !!(q || tagIds.length || colors.length || period[0]);

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
    <Stack gap="sm">
      <PageHeader title="Корзина" hint="Удалённые заметки хранятся 30 дней. При восстановлении вернутся напоминания, чей срок ещё не наступил" />
      <Paper withBorder radius="lg" p="sm" mt={-8}>
        <Group gap="sm" align="flex-end" wrap="wrap">
          <TextInput label="Найти" placeholder="в заголовке и тексте" value={q} onChange={(e) => setQ(e.currentTarget.value)} w={{ base: "100%", sm: 240 }} />
          <MultiSelect label="Теги" placeholder="любые" data={(tags.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))} value={tagIds} onChange={setTagIds} w={{ base: "100%", sm: 200 }} clearable />
          <MultiSelect label="Цвет" placeholder="любой" value={colors} onChange={setColors} w={{ base: "100%", sm: 220 }} clearable
            data={[...PALETTE.map((c) => ({ value: c.key, label: colorLabel(user, c.key) })), { value: "none", label: "Без цвета" }]} />
          <DatePickerInput type="range" label="Когда удалена" placeholder="за всё время" value={period} onChange={(v) => setPeriod(v as [string | null, string | null])} clearable valueFormat="DD.MM.YYYY" w={{ base: "100%", sm: 220 }} />
          {filtered && <Button variant="subtle" onClick={() => { setQ(""); setTagIds([]); setColors([]); setPeriod([null, null]); }}>Сбросить</Button>}
        </Group>
      </Paper>
      <Text size="sm" c="dimmed">В корзине{filtered ? " найдено" : ""}: {trash.data?.length ?? 0}</Text>
      {trash.data?.length === 0 && (
        <Paper withBorder p="xl" ta="center"><Text c="dimmed">{filtered ? "Ничего не найдено — измените фильтры." : "Корзина пуста — удалённые заметки появятся здесь."}</Text></Paper>
      )}
      {trash.data?.map((n) => {
        const days = Math.max(0, Math.ceil(DateTime.fromISO(n.purge_at).diffNow("days").days));
        return (
          <TaskCard
            key={n.id}
            task={{ ...n, is_active: true }}
            when={`на ${fmt(n.start_at, user.timezone, "d MMM yyyy, HH:mm")}`}
            footer={
              <Group justify="space-between" wrap="wrap" gap={6}>
                <Group gap={4}>
                  {wasIn(n).map((w) => <Badge key={w} size="sm" variant="outline" color="gray">{w}</Badge>)}
                  <Text size="xs" c="dimmed">удалена {fmt(n.deleted_at!, user.timezone, "d MMM, HH:mm")} · исчезнет через {days} дн.</Text>
                </Group>
                <Group gap="xs">
                  <Button size="compact-sm" variant="light" onClick={() => act(() => api(`/trash/${n.id}/restore`, { method: "POST" }), "Заметка восстановлена")}>Восстановить</Button>
                  {confirm === n.id ? (
                    <Button size="compact-sm" color="red" onClick={() => act(() => api(`/trash/${n.id}`, { method: "DELETE" }), "Удалено навсегда")}>Точно удалить</Button>
                  ) : (
                    <Button size="compact-sm" color="red" variant="subtle" onClick={() => setConfirm(n.id)}>Удалить навсегда</Button>
                  )}
                </Group>
              </Group>
            }
          />
        );
      })}
    </Stack>
  );
}
