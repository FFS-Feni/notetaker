import { Button, Chip, Group, Paper, RangeSlider, SegmentedControl, Select, SimpleGrid, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api, type Prefs } from "../api";
import { useApp } from "../context";
import { REMINDER_LABEL } from "../time";

const ZONES: string[] = (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Paper withBorder radius="md" p="md">
      <Title order={5}>{title}</Title>
      {hint && <Text size="xs" c="dimmed" mb="sm">{hint}</Text>}
      <Stack gap="sm" mt={hint ? 0 : "sm"}>{children}</Stack>
    </Paper>
  );
}

export function SettingsPage() {
  const { user } = useApp();
  const qc = useQueryClient();
  const p = user.prefs;
  const [email, setEmail] = useState(user.email);
  const [timezone, setTimezone] = useState(user.timezone);
  const [hours, setHours] = useState<[number, number]>([p.day_start, p.day_end]);

  const send = async (body: object, done = "Сохранено") => {
    try {
      await api("/settings", { method: "PATCH", body });
      notifications.show({ message: done, autoClose: 1500 });
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    }
    qc.invalidateQueries();
  };
  // Каждая настройка сохраняется сразу и применяется во всех открытых вкладках.
  const set = <K extends keyof Prefs>(key: K, value: Prefs[K]) => send({ prefs: { [key]: value } });

  const feature = (key: "priorities" | "focus" | "email_reminders" | "popup_reminders", label: string, description: string) => (
    <Switch label={label} description={description} checked={p[key]} onChange={(e) => set(key, e.currentTarget.checked)} />
  );

  return (
    <Stack gap="md" maw={980}>
      <Title order={4}>Настройки</Title>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Section title="Профиль">
          <form onSubmit={(e) => { e.preventDefault(); send({ email, timezone }, "Профиль сохранён"); }}>
            <Stack gap="sm">
              <TextInput label="Почта" description="Сюда приходят письма-напоминания" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} required />
              <Group align="flex-end" wrap="nowrap">
                <Select style={{ flex: 1 }} label="Часовой пояс" searchable data={ZONES.includes(timezone) ? ZONES : [timezone, ...ZONES]} value={timezone} onChange={(v) => v && setTimezone(v)} allowDeselect={false} />
                <Button variant="default" onClick={() => setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone)}>Как у браузера</Button>
              </Group>
              <Text size="xs" c="dimmed">Время заметок показывается в этом поясе. Момент, когда сработает напоминание, от смены пояса не меняется.</Text>
              <Group><Button type="submit">Сохранить профиль</Button></Group>
            </Stack>
          </form>
        </Section>

        <Section title="Функции" hint="Выключенная функция пропадает из интерфейса; данные при этом сохраняются.">
          {feature("priorities", "Приоритеты и «Матрица»", "Отметки «Важно» и «Срочно», экран из четырёх квадрантов, фильтр в списке")}
          {feature("focus", "Фокус дня", `До ${p.focus_limit} главных дел на сегодня — сверху в «Ближайшем»`)}
          {feature("email_reminders", "Письма-напоминания", "Письмо на почту в момент напоминания (уведомление в интерфейсе остаётся)")}
          {feature("popup_reminders", "Всплывающие уведомления", "Уведомление во всех открытых вкладках в момент напоминания")}
        </Section>

        <Section title="Фокус дня" hint="Сколько главных дел можно выбрать на день. Метод «трёх дел» — 3, метод Айви Ли — 6.">
          <SegmentedControl disabled={!p.focus} value={String(p.focus_limit)} onChange={(v) => set("focus_limit", Number(v))}
            data={["1", "2", "3", "4", "5", "6"]} />
        </Section>

        <Section title="Новые заметки" hint="Какие напоминания ставить новой заметке по умолчанию.">
          <Chip.Group multiple value={p.default_reminders.map(String)} onChange={(v) => set("default_reminders", v.map(Number))}>
            <Group gap="xs">
              {Object.entries(REMINDER_LABEL).map(([v, l]) => <Chip key={v} value={v} size="sm">{l}</Chip>)}
            </Group>
          </Chip.Group>
        </Section>

        <Section title="Календарь">
          <Select label="Вид при открытии" value={p.calendar_view} allowDeselect={false}
            onChange={(v) => v && set("calendar_view", v as Prefs["calendar_view"])}
            data={[{ value: "dayGridMonth", label: "Месяц" }, { value: "timeGridWeek", label: "Неделя" }, { value: "timeGridDay", label: "День" }]} />
          <div>
            <Text size="sm" fw={500} mb={4}>Неделя начинается с</Text>
            <SegmentedControl value={String(p.week_start)} onChange={(v) => set("week_start", Number(v) as 0 | 1)}
              data={[{ value: "1", label: "Понедельника" }, { value: "0", label: "Воскресенья" }]} />
          </div>
          <div>
            <Text size="sm" fw={500} mb={4}>Часы в виде «неделя» и «день»: {hours[0]}:00 — {hours[1]}:00</Text>
            <RangeSlider min={0} max={24} minRange={1} step={1} value={hours} onChange={setHours}
              onChangeEnd={([day_start, day_end]) => send({ prefs: { day_start, day_end } })}
              marks={[{ value: 0, label: "0" }, { value: 8, label: "8" }, { value: 18, label: "18" }, { value: 24, label: "24" }]} mb="md" />
          </div>
        </Section>

        <Section title="Общее">
          <Select label="Стартовая страница" value={p.start_page} allowDeselect={false}
            onChange={(v) => v && set("start_page", v as Prefs["start_page"])}
            data={[
              { value: "calendar", label: "Календарь" },
              { value: "notes", label: "Список" },
              { value: "upcoming", label: "Ближайшее" },
              ...(p.priorities ? [{ value: "matrix", label: "Матрица" }] : []),
            ]} />
          <div>
            <Text size="sm" fw={500} mb={4}>Тема</Text>
            <SegmentedControl value={p.theme} onChange={(v) => set("theme", v as Prefs["theme"])}
              data={[{ value: "auto", label: "Как в системе" }, { value: "light", label: "Светлая" }, { value: "dark", label: "Тёмная" }]} />
          </div>
        </Section>
      </SimpleGrid>
    </Stack>
  );
}
