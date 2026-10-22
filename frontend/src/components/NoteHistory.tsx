import { Accordion, Avatar, Group, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { api, type NoteEvent } from "../api";
import { colorLabel } from "../colors";
import { useApp } from "../context";
import { FREQ_LABEL, REMINDER_LABEL, fmt } from "../time";

const ACTION: Record<string, string> = {
  created: "создал(а) заметку", updated: "изменил(а)", trashed: "удалил(а) в корзину",
  restored: "восстановил(а) из корзины", occurrence: "изменил(а) одно вхождение повтора",
};
const FIELD: Record<string, string> = {
  title: "Заголовок", body: "Текст", start_at: "Дата и время", is_active: "Статус", freq: "Повтор", until: "Повтор до",
  reminders: "Напоминания", important: "Важно", urgent: "Срочно", focus_on: "Фокус дня", color: "Цвет",
  triaged: "Доска задач", tags: "Теги", occurrence: "Вхождение",
};

export function NoteHistory({ noteId }: { noteId: string }) {
  const { user } = useApp();
  const history = useQuery({ queryKey: ["note", noteId, "history"], queryFn: () => api<NoteEvent[]>(`/notes/${noteId}/history`) });
  const show = (field: string, v: unknown): string => {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return "—";
    if (field === "is_active") return v ? "активна" : "сделана";
    if (field === "important" || field === "urgent" || field === "triaged") return v ? "да" : "нет";
    if (field === "color") return colorLabel(user, String(v));
    if (field === "freq") return FREQ_LABEL[v as keyof typeof FREQ_LABEL] ?? String(v);
    if (field === "reminders") return (v as number[]).map((m) => REMINDER_LABEL[m]).join(", ");
    if (Array.isArray(v)) return v.join(", ");
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmt(v, user.timezone, "d MMM yyyy, HH:mm");
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return DateTime.fromISO(v).toFormat("dd.MM.yyyy");
    const s = String(v);
    return s.length > 60 ? s.slice(0, 60) + "…" : s;
  };
  const events = history.data ?? [];
  return (
    <Accordion variant="contained" radius="md">
      <Accordion.Item value="history">
        <Accordion.Control>История изменений · {events.length}</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            {events.map((e) => (
              <Group key={e.id} align="flex-start" wrap="nowrap" gap="sm">
                <Avatar size="sm" color="indigo" radius="xl">{e.user_name.slice(0, 1).toUpperCase()}</Avatar>
                <div style={{ minWidth: 0 }}>
                  <Text size="sm"><b>{e.user_name}</b> {ACTION[e.action] ?? e.action}</Text>
                  <Text size="xs" c="dimmed">{fmt(e.at, user.timezone, "d MMM yyyy, HH:mm:ss")}{e.device ? ` · ${e.device}` : ""}</Text>
                  {Object.entries(e.changes).map(([field, change]) => {
                    const [before, after] = Array.isArray(change) ? change : [null, change];
                    return (
                      <Text key={field} size="xs">
                        {FIELD[field] ?? field}: {before !== null && before !== undefined && <><s style={{ opacity: 0.6 }}>{show(field, before)}</s> → </>}{show(field, after)}
                      </Text>
                    );
                  })}
                </div>
              </Group>
            ))}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
