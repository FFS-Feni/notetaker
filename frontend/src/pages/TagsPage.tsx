import { ActionIcon, Badge, Button, ColorInput, Group, Paper, SimpleGrid, Stack, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api, type Tag } from "../api";
import { PALETTE } from "../colors";
import { PageHeader } from "../components/PageHeader";
import { useApp } from "../context";

const SWATCHES = PALETTE.map((c) => c.hex);

function useRun() {
  const qc = useQueryClient();
  return async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) notifications.show({ message: done, autoClose: 1500 });
      qc.invalidateQueries();
      return true;
    } catch (e) {
      notifications.show({ color: "red", message: (e as Error).message });
      qc.invalidateQueries();
      return false;
    }
  };
}

// Что означает каждый цвет — пишет сам пользователь (по умолчанию «Горит», «Работа» и т. д.).
function ColorLabels() {
  const { user } = useApp();
  const run = useRun();
  const [labels, setLabels] = useState<Record<string, string>>(user.prefs.color_labels);
  const save = (key: string) =>
    labels[key] !== user.prefs.color_labels[key] &&
    run(() => api("/settings", { method: "PATCH", body: { prefs: { color_labels: { [key]: labels[key] } } } }), "Название цвета сохранено");
  return (
    <Paper withBorder radius="lg" p="md">
      <Title order={4}>Цвета задач</Title>
      <Text size="sm" c="dimmed" mb="sm">Цвет задаётся в любой вкладке одним кликом по кружку на карточке. Здесь — что означает каждый цвет.</Text>
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="sm">
        {PALETTE.map((c) => (
          <Group key={c.key} gap={8} wrap="nowrap">
            <span style={{ width: 28, height: 28, borderRadius: 8, background: c.hex, flex: "none" }} />
            <TextInput style={{ flex: 1 }} size="sm" value={labels[c.key] ?? ""} aria-label={`Название цвета ${c.key}`}
              onChange={(e) => setLabels({ ...labels, [c.key]: e.currentTarget.value })}
              onBlur={() => save(c.key)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
          </Group>
        ))}
      </SimpleGrid>
    </Paper>
  );
}

function TagCard({ tag }: { tag: Tag }) {
  const run = useRun();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const [confirm, setConfirm] = useState(false);
  const save = async () => {
    if (await run(() => api(`/tags/${tag.id}`, { method: "PATCH", body: { name, color } }), "Тег сохранён")) setEditing(false);
  };
  return (
    <Paper withBorder radius="lg" p="md" style={{ borderTop: `5px solid ${tag.color}` }}>
      {editing ? (
        <Stack gap="xs">
          <TextInput label="Название" value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus onKeyDown={(e) => e.key === "Enter" && save()} />
          <ColorInput label="Цвет" value={color} onChange={setColor} swatches={SWATCHES} swatchesPerRow={8} />
          <Group gap="xs" justify="flex-end">
            <Button size="xs" variant="default" onClick={() => { setEditing(false); setName(tag.name); setColor(tag.color); }}>Отмена</Button>
            <Button size="xs" onClick={save}>Сохранить</Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap={6}>
          <Group justify="space-between" wrap="nowrap">
            <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
              <span style={{ width: 14, height: 14, borderRadius: "50%", background: tag.color, flex: "none" }} />
              <Text fw={700} size="lg" truncate>{tag.name}</Text>
            </Group>
            <Group gap={2} wrap="nowrap">
              <Tooltip label="Изменить"><ActionIcon variant="subtle" color="gray" aria-label="Изменить тег" onClick={() => setEditing(true)}>✎</ActionIcon></Tooltip>
              {confirm ? (
                <Button size="compact-xs" color="red" onClick={() => run(() => api(`/tags/${tag.id}`, { method: "DELETE" }), "Тег удалён")}>Удалить?</Button>
              ) : (
                <Tooltip label="Удалить (заметки останутся)"><ActionIcon variant="subtle" color="red" aria-label="Удалить тег" onClick={() => setConfirm(true)}>✕</ActionIcon></Tooltip>
              )}
            </Group>
          </Group>
          <Group justify="space-between">
            <Badge variant="light" color="gray">{tag.count ?? 0} {plural(tag.count ?? 0)}</Badge>
            <Button size="compact-sm" variant="light" onClick={() => navigate(`/notes?tag=${tag.id}`)} disabled={!tag.count}>Показать заметки →</Button>
          </Group>
        </Stack>
      )}
    </Paper>
  );
}

const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "заметка" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "заметки" : "заметок");

export function TagsPage() {
  const run = useRun();
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api<Tag[]>("/tags") });
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(SWATCHES[5]);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => api("/tags", { method: "POST", body: { name, color } }), "Тег добавлен")) setName("");
  };
  return (
    <Stack gap="md">
      <PageHeader title="Цвета и теги" hint="Цвет — одна главная метка задачи. Теги — сколько угодно тем на задаче (например, «Клиенты», «Дом»)" />
      <ColorLabels />
      <Paper withBorder radius="lg" p="md">
        <Group justify="space-between" mb="sm" wrap="wrap" gap="sm">
          <Title order={4}>Теги <Text span c="dimmed" size="sm">{tags.data?.length ?? 0}</Text></Title>
          <form onSubmit={create}>
            <Group gap="xs" wrap="nowrap">
              <ColorInput w={120} size="sm" value={color} onChange={setColor} swatches={SWATCHES} swatchesPerRow={8} aria-label="Цвет нового тега" />
              <TextInput size="sm" placeholder="Новый тег" value={name} onChange={(e) => setName(e.currentTarget.value)} required aria-label="Новый тег" />
              <Button size="sm" type="submit">Добавить</Button>
            </Group>
          </form>
        </Group>
        {tags.data?.length === 0 && <Text c="dimmed" ta="center" py="lg">Тегов пока нет — добавьте первый справа вверху.</Text>}
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
          {tags.data?.map((t) => <TagCard key={`${t.id}-${t.name}-${t.color}`} tag={t} />)}
        </SimpleGrid>
      </Paper>
    </Stack>
  );
}
