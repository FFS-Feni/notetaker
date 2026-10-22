import { ActionIcon, Badge, Checkbox, Group, Popover, Progress, Stack, Text, TextInput } from "@mantine/core";
import { useState } from "react";
import type { CheckItem } from "../api";

// Редактор чек-листа в заметке: галочка, текст, удалить; новый пункт — Enter.
export function ChecklistEditor({ value, onChange }: { value: CheckItem[]; onChange: (v: CheckItem[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    if (!draft.trim()) return;
    onChange([...value, { text: draft.trim(), done: false }]);
    setDraft("");
  };
  const done = value.filter((i) => i.done).length;
  return (
    <Stack gap={6}>
      {value.length > 0 && <Progress value={(done / value.length) * 100} size="sm" color="teal" />}
      {value.map((item, i) => (
        <Group key={i} gap={8} wrap="nowrap">
          <Checkbox checked={item.done} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, done: e.currentTarget.checked } : x)))} aria-label={item.text} />
          <TextInput variant="unstyled" size="sm" style={{ flex: 1 }} value={item.text} td={item.done ? "line-through" : undefined}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, text: e.currentTarget.value } : x)))} />
          <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Удалить пункт" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</ActionIcon>
        </Group>
      ))}
      <TextInput size="sm" placeholder="Добавить пункт и нажать Enter" value={draft} onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} onBlur={add} aria-label="Новый пункт чек-листа" />
    </Stack>
  );
}

// Прогресс «2/5» на карточке; клик — отметить пункты, не открывая заметку.
export function ChecklistBadge({ items, onChange }: { items: CheckItem[]; onChange?: (v: CheckItem[]) => void }) {
  const [opened, setOpened] = useState(false);
  if (!items.length) return null;
  const done = items.filter((i) => i.done).length;
  const badge = (
    <Badge size="xs" variant={done === items.length ? "filled" : "light"} color="teal" style={{ cursor: onChange ? "pointer" : undefined }}
      onClick={(e) => { if (onChange) { e.stopPropagation(); setOpened((o) => !o); } }}>
      ☑ {done}/{items.length}
    </Badge>
  );
  if (!onChange) return badge;
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-start" shadow="md" withinPortal>
      <Popover.Target>{badge}</Popover.Target>
      <Popover.Dropdown onClick={(e) => e.stopPropagation()} maw={320}>
        <Text size="xs" c="dimmed" fw={700} mb={6}>Чек-лист</Text>
        <Stack gap={6}>
          {items.map((item, i) => (
            <Checkbox key={i} label={item.text} checked={item.done}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, done: e.currentTarget.checked } : x)))} />
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
