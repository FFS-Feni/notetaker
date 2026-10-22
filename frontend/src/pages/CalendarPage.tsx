import ruLocale from "@fullcalendar/core/locales/ru";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import { Paper } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useState } from "react";
import { api, ApiError, occPath, type Occurrence } from "../api";
import { useApp } from "../context";

export function CalendarPage() {
  const { user, openEditor } = useApp();
  const qc = useQueryClient();
  const mobile = useMediaQuery("(max-width: 48em)", window.matchMedia("(max-width: 48em)").matches, { getInitialValueInEffect: false });
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  // Сервер отдаёт вхождения только видимого периода — повторы разворачиваются там же.
  const occ = useQuery({
    queryKey: ["occurrences", range],
    queryFn: () => api<Occurrence[]>("/occurrences", { params: range! }),
    enabled: !!range,
    placeholderData: keepPreviousData,
  });

  const move = async (o: Occurrence, startStr: string, revert: () => void) => {
    const start_at = DateTime.fromISO(startStr).toUTC().toISO();
    try {
      // Обычную заметку переносим целиком, вхождение серии — только его (исключение).
      if (o.freq === "none") await api(`/notes/${o.note_id}`, { method: "PATCH", body: { version: o.version, start_at } });
      else await api(occPath(o), { method: "PATCH", params: { scope: "this" }, body: { version: o.version, start_at } });
      notifications.show({ message: o.freq === "none" ? "Заметка перенесена" : "Перенесено только это вхождение" });
    } catch (e) {
      revert();
      notifications.show({
        color: "red",
        message: e instanceof ApiError && e.status === 409 ? "Заметку только что изменили в другом месте — календарь обновлён" : (e as Error).message,
      });
    } finally {
      qc.invalidateQueries();
    }
  };

  return (
    <Paper withBorder p="sm" radius="md">
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, luxonPlugin]}
        locale={ruLocale}
        timeZone={user.timezone}
        // На телефоне месяц нечитаем — открываем день, переключатель видов уходит вниз.
        initialView={mobile ? "timeGridDay" : "dayGridMonth"}
        headerToolbar={mobile
          ? { left: "prev,next", center: "title", right: "today" }
          : { left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay" }}
        footerToolbar={mobile ? { center: "dayGridMonth,timeGridWeek,timeGridDay" } : undefined}
        scrollTime="08:00:00"
        height="auto"
        dayMaxEvents={4}
        eventDisplay="block"
        allDaySlot={false}
        nowIndicator
        editable
        eventDurationEditable={false}
        eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
        slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
        datesSet={(a) => setRange({ from: a.startStr, to: a.endStr })}
        events={(occ.data ?? []).map((o) => ({
          id: o.id,
          title: o.title + (o.freq !== "none" ? " ↻" : ""),
          start: o.start,
          allDay: false,
          backgroundColor: o.is_active ? (o.tags[0]?.color ?? "#5cb0ee") : "transparent",
          borderColor: o.tags[0]?.color ?? "#5cb0ee",
          textColor: "#111",
          classNames: o.is_active ? [] : ["nt-inactive"],
          extendedProps: { occ: o },
        }))}
        eventClick={(i) => {
          const o = i.event.extendedProps.occ as Occurrence;
          openEditor(o.freq === "none" ? { kind: "note", id: o.note_id } : { kind: "occ", occ: o });
        }}
        dateClick={(i) => {
          const start = i.allDay || i.view.type === "dayGridMonth"
            ? `${i.dateStr.slice(0, 10)} 09:00:00`
            : DateTime.fromISO(i.dateStr).setZone(user.timezone).toFormat("yyyy-MM-dd HH:mm:ss");
          openEditor({ kind: "new", start });
        }}
        eventDrop={(i) => move(i.event.extendedProps.occ as Occurrence, i.event.startStr, i.revert)}
      />
    </Paper>
  );
}
