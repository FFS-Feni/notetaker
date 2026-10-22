import { Badge, Group, Loader, Paper, Popover, Text, TextInput } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Note, type QuickParsed } from "../api";
import { colorHex } from "../colors";
import { useApp } from "../context";
import { fmt } from "../time";

// Заметка одной строкой: «завтра в 9 позвонить маме #дом !важно каждую неделю». Сервер разбирает, мы показываем, что понял.
export function QuickAdd({ autoFocus = false }: { autoFocus?: boolean }) {
  const { user } = useApp();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [debounced] = useDebouncedValue(text.trim(), 250);
  const [busy, setBusy] = useState(false);
  const parsed = useQuery({
    queryKey: ["quick-parse", debounced],
    queryFn: () => api<QuickParsed>("/notes/parse", { method: "POST", body: { text: debounced } }),
    enabled: debounced.length > 1,
    staleTime: 30_000,
  });
  const p = debounced === text.trim() ? parsed.data : undefined;

  const create = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const note = await api<Note>("/notes/quick", { method: "POST", body: { text } });
      notifications.show({ color: "teal", title: "Заметка создана", message: `${note.title} · ${fmt(note.start_at, user.timezone, "ccc d MMM, HH:mm")}` });
      setText("");
      qc.invalidateQueries();
    } catch (e) {
      notifications.show({ color: "red", message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover opened={!!text.trim()} position="bottom-start" width="target" shadow="md" withinPortal>
      <Popover.Target>
        <TextInput
          aria-label="Быстрая заметка"
          placeholder="Быстро: «завтра в 9 позвонить маме #дом !важно» — Enter"
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
            if (e.key === "Escape") setText("");
          }}
          rightSection={busy || parsed.isFetching ? <Loader size="xs" /> : null}
          radius="xl"
          style={{ flex: 1 }}
        />
      </Popover.Target>
      <Popover.Dropdown p="xs">
        {!p ? (
          <Text size="xs" c="dimmed">Распознаю…</Text>
        ) : (
          <Paper p={0}>
            <Group gap={6} mb={4}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: colorHex(p.color) ?? "var(--mantine-color-dimmed)" }} />
              <Text fw={600} size="sm">{p.title || <Text span c="red" size="sm">напишите, что сделать</Text>}</Text>
            </Group>
            <Group gap={4}>
              <Badge variant="light" color="indigo">{fmt(p.start_at, user.timezone, "ccc d MMM, HH:mm")}</Badge>
              {p.hints.filter((h) => !/^\d/.test(h)).map((h) => (
                <Badge key={h} variant="light" color={h.startsWith("#") ? "gray" : h === "важно" ? "red" : h === "срочно" ? "orange" : "teal"}>
                  {h}{p.new_tags.includes(h.slice(1)) ? " (новый)" : ""}
                </Badge>
              ))}
            </Group>
            <Text size="xs" c="dimmed" mt={6}>Enter — создать · Esc — очистить · можно: завтра, в пятницу, 25.10, через 2 часа, в 7 вечера, каждую неделю, напомнить за час, #тег, !важно, !срочно, *синий</Text>
          </Paper>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
