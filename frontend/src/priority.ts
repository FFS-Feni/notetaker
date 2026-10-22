import { DateTime } from "luxon";
import { api } from "./api";

// Матрица Эйзенхауэра: две отметки → четыре квадранта и что с ними делать.
export const QUADRANTS = [
  { key: "do", title: "Важные и срочные", hint: "Сделать сейчас, первым делом", important: true, urgent: true, color: "red" },
  { key: "plan", title: "Важные, но несрочные", hint: "Запланировать и выделить время", important: true, urgent: false, color: "blue" },
  { key: "delegate", title: "Срочные, но неважные", hint: "Поручить или закрыть за 5 минут", important: false, urgent: true, color: "orange" },
  { key: "drop", title: "Неважные и несрочные", hint: "Отложить или удалить", important: false, urgent: false, color: "gray" },
] as const;
export type QuadrantKey = (typeof QUADRANTS)[number]["key"];

export const todayIn = (tz: string) => DateTime.now().setZone(tz).toISODate()!;

// «Фокус дня»: день (по поясу пользователя) или null — убрать из фокуса. Больше трёх сервер не даст.
export const setFocus = (note: { id: string; version: number }, day: string | null) =>
  api(`/notes/${note.id}`, { method: "PATCH", body: { version: note.version, focus_on: day } });
