import { ActionIcon, Group, Popover, Stack, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { useState } from "react";
import { PALETTE, colorHex, colorLabel } from "../colors";
import { useApp } from "../context";

function Swatch({ hex, active, onClick, label, size = 22 }: { hex?: string; active: boolean; onClick: () => void; label: string; size?: number }) {
  return (
    <Tooltip label={label} openDelay={200}>
      <UnstyledButton
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: hex ?? "transparent",
          border: hex ? "none" : "1.5px dashed var(--mantine-color-dimmed)",
          outline: active ? "2px solid var(--mantine-color-text)" : "none",
          outlineOffset: 2,
        }}
      />
    </Tooltip>
  );
}

// Палитра: 8 цветов с названиями пользователя + «без цвета».
export function ColorPicker({ value, onChange, withNone = true }: { value: string | null; onChange: (v: string | null) => void; withNone?: boolean }) {
  const { user } = useApp();
  return (
    <Group gap={8}>
      {withNone && <Swatch active={!value} onClick={() => onChange(null)} label="Без цвета" />}
      {PALETTE.map((c) => (
        <Swatch key={c.key} hex={c.hex} active={value === c.key} onClick={() => onChange(c.key)} label={colorLabel(user, c.key)} />
      ))}
    </Group>
  );
}

// Кружок цвета на карточке: клик — палитра с подписями, выбор в один клик.
export function ColorDot({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { user } = useApp();
  const [opened, setOpened] = useState(false);
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" shadow="md" withinPortal>
      <Popover.Target>
        <ActionIcon variant="subtle" color="gray" aria-label="Цвет задачи" onClick={(e) => { e.stopPropagation(); setOpened((o) => !o); }}>
          <span style={{ width: 14, height: 14, borderRadius: "50%", background: colorHex(value) ?? "transparent", border: value ? "none" : "1.5px dashed var(--mantine-color-dimmed)" }} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown onClick={(e) => e.stopPropagation()}>
        <Stack gap={4}>
          <Text size="xs" c="dimmed" fw={700}>Цвет задачи</Text>
          {[null, ...PALETTE.map((c) => c.key)].map((key) => (
            <UnstyledButton key={key ?? "none"} onClick={() => { onChange(key); setOpened(false); }}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 6px", borderRadius: 6, background: value === key ? "var(--mantine-color-default-hover)" : undefined }}>
              <span style={{ width: 14, height: 14, borderRadius: "50%", background: colorHex(key) ?? "transparent", border: key ? "none" : "1.5px dashed var(--mantine-color-dimmed)" }} />
              <Text size="sm">{colorLabel(user, key)}</Text>
            </UnstyledButton>
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
