import { Badge, Group, Paper, Text } from "@mantine/core";
import type { ReactNode } from "react";
import type { CheckItem, Tag } from "../api";
import { ChecklistBadge } from "./Checklist";
import { taskHex } from "../colors";
import { useApp } from "../context";

export type CardTask = {
  title: string;
  body?: string;
  tags: Tag[];
  color: string | null;
  important?: boolean;
  urgent?: boolean;
  is_active: boolean;
  freq?: string;
  checklist?: CheckItem[];
};

// Единая карточка задачи для всех вкладок: цветная полоса слева, заголовок, когда, метки, действия справа.
export function TaskCard({
  task, when, actions, footer, onClick, draggableId, dense, testId, onChecklist,
}: {
  onChecklist?: (items: CheckItem[]) => void;
  task: CardTask;
  when?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  onClick?: () => void;
  draggableId?: string;
  dense?: boolean;
  testId?: string;
}) {
  const { user } = useApp();
  const hex = taskHex(task);
  return (
    <Paper
      withBorder
      radius="md"
      data-testid={testId}
      draggable={!!draggableId}
      onDragStart={draggableId ? (e) => e.dataTransfer.setData("text/plain", draggableId) : undefined}
      onClick={onClick}
      style={{
        cursor: draggableId ? "grab" : onClick ? "pointer" : undefined,
        borderLeft: `5px solid ${hex ?? "var(--mantine-color-default-border)"}`,
        opacity: task.is_active ? 1 : 0.55,
        padding: dense ? "6px 8px" : "8px 10px",
      }}
    >
      <Group justify="space-between" wrap="nowrap" gap={6} align="flex-start">
        <div style={{ minWidth: 0, flex: 1 }}>
          <Text fw={600} size={dense ? "sm" : "md"} lh={1.3} td={task.is_active ? undefined : "line-through"} style={{ wordBreak: "break-word" }}>
            {user.prefs.priorities && task.important ? "❗ " : ""}{task.title}
          </Text>
          {!dense && task.body ? <Text size="xs" c="dimmed" lineClamp={1}>{task.body}</Text> : null}
          <Group gap={4} mt={3} wrap="wrap">
            {when && <Text size="xs" c="dimmed" fw={500}>{when}{task.freq && task.freq !== "none" ? " · ↻" : ""}</Text>}
            <ChecklistBadge items={task.checklist ?? []} onChange={onChecklist} />
            {user.prefs.priorities && task.urgent && <Badge size="xs" color="orange" variant="outline">срочно</Badge>}
            {task.tags.map((t) => <Badge key={t.id} size="xs" variant="dot" color={t.color}>{t.name}</Badge>)}
          </Group>
        </div>
        {actions && <Group gap={2} wrap="nowrap" onClick={(e) => e.stopPropagation()}>{actions}</Group>}
      </Group>
      {footer && <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 6 }}>{footer}</div>}
    </Paper>
  );
}
