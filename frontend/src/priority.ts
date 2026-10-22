import { DateTime } from "luxon";
import { api } from "./api";

// Матрица Эйзенхауэра: две отметки → четыре квадранта и что с ними делать.
export const QUADRANTS = [
  { key: "do", title: "Сделать сейчас", hint: "Важно и срочно — первым делом", important: true, urgent: true, color: "red" },
  { key: "plan", title: "Запланировать", hint: "Важно, но не срочно — выделить время", important: true, urgent: false, color: "blue" },
  { key: "delegate", title: "Поручить или быстро", hint: "Срочно, но не важно — отдать или закрыть за 5 минут", important: false, urgent: true, color: "orange" },
  { key: "drop", title: "Отложить", hint: "Не важно и не срочно — когда-нибудь или удалить", important: false, urgent: false, color: "gray" },
] as const;
export type QuadrantKey = (typeof QUADRANTS)[number]["key"];

export const todayIn = (tz: string) => DateTime.now().setZone(tz).toISODate()!;

// «Фокус дня»: день (по поясу пользователя) или null — убрать из фокуса. Больше трёх сервер не даст.
export const setFocus = (note: { id: string; version: number }, day: string | null) =>
  api(`/notes/${note.id}`, { method: "PATCH", body: { version: note.version, focus_on: day } });
