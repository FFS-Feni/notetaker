import { ActionIcon, Button, ColorInput, Group, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Tag } from "../api";

const SWATCHES = ["#f0a93e", "#5cb0ee", "#e7799e", "#47c2a2", "#ad9ff7", "#ef6b6b", "#9aa3b2"];

function TagRow({ tag }: { tag: Tag }) {
  const qc = useQueryClient();
  const [name, setName] = useState(tag.name);
  const update = async (body: Partial<Tag>) => {
    try {
      await api(`/tags/${tag.id}`, { method: "PATCH", body });
    } catch (e) {
      notifications.show({ color: "red", message: (e as Error).message });
      setName(tag.name);
    }
    qc.invalidateQueries();
  };
  return (
    <Paper withBorder p="xs" radius="md">
      <Group wrap="nowrap">
        <ColorInput w={130} value={tag.color} swatches={SWATCHES} onChangeEnd={(color) => update({ color })} aria-label="Цвет" />
        <TextInput style={{ flex: 1 }} value={name} onChange={(e) => setName(e.currentTarget.value)}
          onBlur={() => name !== tag.name && update({ name })} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} aria-label="Имя тега" />
        <ActionIcon color="red" variant="subtle" aria-label="Удалить тег" onClick={async () => { await api(`/tags/${tag.id}`, { method: "DELETE" }); qc.invalidateQueries(); }}>✕</ActionIcon>
      </Group>
    </Paper>
  );
}

export function TagsPage() {
  const qc = useQueryClient();
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api<Tag[]>("/tags") });
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[1]);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("/tags", { method: "POST", body: { name, color } });
      setName("");
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    }
    qc.invalidateQueries();
  };
  return (
    <Stack gap="sm" maw={600}>
      <Title order={4}>Теги</Title>
      <Text size="sm" c="dimmed">Имя меняется на месте (Enter). Удаление тега снимает его с заметок, сами заметки остаются.</Text>
      {tags.data?.map((t) => <TagRow key={`${t.id}-${t.name}`} tag={t} />)}
      <form onSubmit={create}>
        <Group wrap="nowrap" align="flex-end">
          <ColorInput w={130} label="Цвет" value={color} onChange={setColor} swatches={SWATCHES} />
          <TextInput style={{ flex: 1 }} label="Новый тег" value={name} onChange={(e) => setName(e.currentTarget.value)} required />
          <Button type="submit">Добавить</Button>
        </Group>
      </form>
    </Stack>
  );
}
