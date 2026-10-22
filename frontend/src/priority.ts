import { DateTime } from "luxon";
import { api } from "./api";

// Матрица Эйзенхауэра: две отметки → четыре квадранта и что с ними делать.
export const QUADRANTS = [
  { key: "do", title: "Сделать сейчас", hint: "Важно и срочно", important: true, urgent: true, color: "red" },
  { key: "plan", title: "Запланировать", hint: "Важно, но не срочно — здесь растёт главное", important: true, urgent: false, color: "blue" },
  { key: "delegate", title: "Делегировать или сделать быстро", hint: "Срочно, но не важно", important: false, urgent: true, color: "orange" },
  { key: "drop", title: "Отложить или удалить", hint: "Не важно и не срочно", important: false, urgent: false, color: "gray" },
] as const;
export type QuadrantKey = (typeof QUADRANTS)[number]["key"];

export const todayIn = (tz: string) => DateTime.now().setZone(tz).toISODate()!;

// «Фокус дня»: день (по поясу пользователя) или null — убрать из фокуса. Больше трёх сервер не даст.
export const setFocus = (note: { id: string; version: number }, day: string | null) =>
  api(`/notes/${note.id}`, { method: "PATCH", body: { version: note.version, focus_on: day } });
