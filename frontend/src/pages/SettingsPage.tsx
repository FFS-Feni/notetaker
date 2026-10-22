import { Button, Group, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { useApp } from "../context";

const ZONES: string[] = (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");

export function SettingsPage() {
  const { user } = useApp();
  const qc = useQueryClient();
  const [email, setEmail] = useState(user.email);
  const [timezone, setTimezone] = useState(user.timezone);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("/settings", { method: "PATCH", body: { email, timezone } });
      notifications.show({ message: "Настройки сохранены" });
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    }
    qc.invalidateQueries();
  };
  return (
    <form onSubmit={save}>
      <Stack gap="sm" maw={480}>
        <Title order={4}>Настройки</Title>
        <TextInput label="Почта" description="Сюда приходят письма-напоминания" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} required />
        <Group align="flex-end" wrap="nowrap">
          <Select style={{ flex: 1 }} label="Часовой пояс" searchable data={ZONES.includes(timezone) ? ZONES : [timezone, ...ZONES]} value={timezone} onChange={(v) => v && setTimezone(v)} allowDeselect={false} />
          <Button variant="default" onClick={() => setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone)}>Как у браузера</Button>
        </Group>
        <Text size="sm" c="dimmed">Время заметок показывается в этом поясе. Момент, когда сработает напоминание, от смены пояса не меняется.</Text>
        <Group><Button type="submit">Сохранить</Button></Group>
      </Stack>
    </form>
  );
}
