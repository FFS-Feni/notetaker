import {
  Alert,
  Button,
  Chip,
  Group,
  Modal,
  MultiSelect,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { DatePickerInput, DateTimePicker } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, occPath, type Freq, type Note, type Tag } from "../api";
import { useApp, type EditorTarget } from "../context";
import { FREQ_LABEL, fmt, fromWall, REMINDER_LABEL, toWall } from "../time";

type Form = {
  title: string;
  body: string;
  start: string; // «YYYY-MM-DD HH:mm:ss» в поясе пользователя
  is_active: boolean;
  freq: Freq;
  until: string | null;
  reminders: string[];
  tag_ids: string[];
  important: boolean;
  urgent: boolean;
};
type Scope = "this" | "following" | "all";

function formFrom(note: Note | undefined, target: EditorTarget, tz: string, defaultReminders: number[]): Form {
  if (!note) {
    const start =
      target.kind === "new" && target.start
        ? target.start
        : DateTime.now().setZone(tz).plus({ hours: 1 }).startOf("hour").toFormat("yyyy-MM-dd HH:mm:ss");
    return { title: "", body: "", start, is_active: true, freq: "none", until: null, reminders: defaultReminders.map(String), tag_ids: [], important: false, urgent: false };
  }
  const occ = target.kind === "occ" ? target.occ : null;
  return {
    title: occ?.title ?? note.title,
    body: occ?.body ?? note.body,
    start: toWall(occ?.start ?? note.start_at, tz),
    is_active: occ?.is_active ?? note.is_active,
    freq: note.freq,
    until: note.until,
    reminders: note.reminders.map(String),
    tag_ids: note.tags.map((t) => String(t.id)),
    important: note.important,
    urgent: note.urgent,
  };
}

export function NoteEditor({ target, onClose }: { target: EditorTarget; onClose: () => void }) {
  const { user } = useApp();
  const tz = user.timezone;
  const prefs = user.prefs;
  const qc = useQueryClient();
  const noteId = target.kind === "note" ? target.id : target.kind === "occ" ? target.occ.note_id : null;
  const note = useQuery({ queryKey: ["note", noteId], queryFn: () => api<Note>(`/notes/${noteId}`), enabled: !!noteId });
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api<Tag[]>("/tags") });

  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<Form | null>(null); // с чем сравниваем, есть ли несохранённое
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [theirs, setTheirs] = useState<Note | null>(null); // чужая новая версия, пока у нас есть правки
  const [scope, setScope] = useState<Scope>("this");
  const [busy, setBusy] = useState(false);
  const occ = target.kind === "occ" ? target.occ : null;
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);

  // Первая загрузка — заполняем форму. Пришла новая версия (событие из другой вкладки):
  // нет своих правок — молча обновляем; есть — показываем баннер, ничего не теряя.
  useEffect(() => {
    if (noteId && !note.data) return;
    if (form === null) {
      const f = formFrom(note.data, target, tz, prefs.default_reminders);
      setForm(f);
      setSaved(f);
      setBaseVersion(note.data?.version ?? null);
      return;
    }
    if (note.data && baseVersion !== null && note.data.version > baseVersion) {
      if (!dirty) {
        const f = formFrom(note.data, target, tz, prefs.default_reminders);
        setForm(f);
        setSaved(f);
        setBaseVersion(note.data.version);
      } else setTheirs(note.data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.data]);

  if (!form) return null;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });
  const seriesFields = !occ || scope === "all";

  const takeTheirs = () => {
    if (!theirs) return;
    const f = formFrom(theirs, target, tz, prefs.default_reminders);
    setForm(f);
    setSaved(f);
    setBaseVersion(theirs.version);
    setTheirs(null);
  };
  const keepMine = () => {
    if (!theirs) return;
    setBaseVersion(theirs.version);
    setTheirs(null);
  };
  const copyMine = async () => {
    try {
      await navigator.clipboard.writeText(`${form.title}\n\n${form.body}`);
      notifications.show({ message: "Ваш текст скопирован" });
    } catch {
      notifications.show({ color: "red", message: "Не удалось скопировать — выделите текст вручную" });
    }
  };

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      notifications.show({ message: done });
      qc.invalidateQueries();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const current = (e.detail as { current?: Note })?.current;
        if (current) setTheirs(current);
        else notifications.show({ color: "red", message: e.message });
      } else notifications.show({ color: "red", message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const start_at = fromWall(form.start, tz);
    const series = {
      title: form.title,
      body: form.body,
      is_active: form.is_active,
      freq: form.freq,
      until: form.freq === "none" ? null : form.until,
      reminders: form.reminders.map(Number),
      tag_ids: form.tag_ids.map(Number),
      important: form.important,
      urgent: form.urgent,
    };
    if (target.kind === "new")
      return run(() => api("/notes", { method: "POST", body: { ...series, start_at } }), "Заметка создана");
    if (occ && scope !== "all")
      return run(
        () =>
          api(occPath(occ), {
            method: "PATCH",
            params: { scope },
            body: { version: baseVersion, title: form.title, body: form.body, is_active: form.is_active, start_at },
          }),
        "Сохранено",
      );
    // Вся серия: сдвиг времени вхождения сдвигает начало серии на ту же величину.
    let seriesStart = start_at;
    if (occ && note.data)
      seriesStart = DateTime.fromISO(note.data.start_at)
        .plus(DateTime.fromISO(start_at).diff(DateTime.fromISO(occ.start)))
        .toUTC()
        .toISO()!;
    return run(
      () => api(`/notes/${noteId}`, { method: "PATCH", body: { version: baseVersion, ...series, start_at: seriesStart } }),
      "Сохранено",
    );
  };

  const remove = () => {
    if (occ && scope !== "all")
      return run(
        () => api(occPath(occ), { method: "DELETE", params: { scope, version: baseVersion } }),
        scope === "this" ? "Вхождение удалено" : "Серия закончена накануне",
      );
    return run(() => api(`/notes/${noteId}`, { method: "DELETE" }), "Заметка в корзине");
  };

  return (
    <Modal
      opened
      onClose={onClose}
      size="lg"
      title={
        target.kind === "new" ? "Новая заметка" : occ ? `Повторяющаяся заметка · ${fmt(occ.start, tz, "d MMMM, HH:mm")}` : "Заметка"
      }
    >
      <Stack gap="sm">
        {theirs && (
          <Alert color="orange" title="Заметку изменили в другой вкладке или на другом устройстве">
            <Text size="sm" mb="xs">
              Сейчас там: «{theirs.title}», {fmt(theirs.start_at, tz)}. Ваши правки не сохранены — выберите, что делать.
            </Text>
            <Group gap="xs">
              <Button size="xs" variant="default" onClick={takeTheirs}>Показать их версию</Button>
              <Button size="xs" variant="default" onClick={keepMine}>Сохранить мою поверх</Button>
              <Button size="xs" variant="default" onClick={copyMine}>Скопировать мой текст</Button>
            </Group>
          </Alert>
        )}
        {occ && (
          <div>
            <Text size="sm" fw={500} mb={4}>Что меняем</Text>
            <SegmentedControl
              fullWidth
              value={scope}
              onChange={(v) => setScope(v as Scope)}
              data={[
                { value: "this", label: "Только это" },
                { value: "following", label: "Это и следующие" },
                { value: "all", label: "Все" },
              ]}
            />
          </div>
        )}
        <TextInput label="Заголовок" required value={form.title} onChange={(e) => set("title", e.currentTarget.value)} data-autofocus />
        <Textarea label="Текст" autosize minRows={2} maxRows={8} value={form.body} onChange={(e) => set("body", e.currentTarget.value)} />
        <Group grow align="flex-end">
          <DateTimePicker
            label={`Дата и время (${tz})`}
            value={form.start}
            onChange={(v) => v && set("start", v)}
            valueFormat="DD.MM.YYYY HH:mm"
            locale="ru"
          />
          <Switch label="Активна" checked={form.is_active} onChange={(e) => set("is_active", e.currentTarget.checked)} mb={8} />
        </Group>
        {seriesFields ? (
          <>
            <Group grow align="flex-end">
              <Select
                label="Повтор"
                value={form.freq}
                onChange={(v) => set("freq", (v ?? "none") as Freq)}
                data={Object.entries(FREQ_LABEL).map(([value, label]) => ({ value, label }))}
                allowDeselect={false}
              />
              {form.freq !== "none" && (
                <DatePickerInput
                  label="До (включительно)"
                  placeholder="без конца"
                  clearable
                  value={form.until}
                  onChange={(v) => set("until", v)}
                  valueFormat="DD.MM.YYYY"
                  locale="ru"
                />
              )}
            </Group>
            {prefs.priorities && <div>
              <Text size="sm" fw={500} mb={4}>Приоритет</Text>
              <Group gap="xs">
                <Chip size="sm" color="red" checked={form.important} onChange={(v) => set("important", v)}>Важно</Chip>
                <Chip size="sm" color="orange" checked={form.urgent} onChange={(v) => set("urgent", v)}>Срочно</Chip>
              </Group>
            </div>}
            <div>
              <Text size="sm" fw={500} mb={4}>Напомнить</Text>
              <Chip.Group multiple value={form.reminders} onChange={(v) => set("reminders", v)}>
                <Group gap="xs">
                  {Object.entries(REMINDER_LABEL).map(([v, l]) => (
                    <Chip key={v} value={v} size="sm">{l}</Chip>
                  ))}
                </Group>
              </Chip.Group>
            </div>
            <MultiSelect
              label="Теги"
              placeholder="без тегов"
              value={form.tag_ids}
              onChange={(v) => set("tag_ids", v)}
              data={(tags.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))}
              searchable
            />
          </>
        ) : (
          <Text size="xs" c="dimmed">Повтор, напоминания и теги задаются для всей серии — выберите «Все».</Text>
        )}
        <Group justify="space-between" mt="sm">
          {target.kind !== "new" ? (
            <Button color="red" variant="subtle" onClick={remove} loading={busy}>
              {occ && scope === "this" ? "Удалить это вхождение" : occ && scope === "following" ? "Удалить это и следующие" : "В корзину"}
            </Button>
          ) : (
            <span />
          )}
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>Отмена</Button>
            <Button onClick={save} loading={busy} disabled={!form.title.trim() || !!theirs}>Сохранить</Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
