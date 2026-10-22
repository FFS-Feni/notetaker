import { Group, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

// Единый заголовок экрана: что это и зачем — одной строкой, справа — действия.
export function PageHeader({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-end" mb="md" gap="sm">
      <div style={{ minWidth: 0 }}>
        <Title order={3}>{title}</Title>
        {hint && <Text size="sm" c="dimmed">{hint}</Text>}
      </div>
      {children && <Group gap="xs">{children}</Group>}
    </Group>
  );
}
