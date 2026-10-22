import { DateTime } from "luxon";

// В базе — UTC. Показываем и вводим — в поясе из настроек пользователя (не браузера).
export const fmt = (iso: string, tz: string, f = "dd.MM.yyyy HH:mm") =>
  DateTime.fromISO(iso).setZone(tz).setLocale("ru").toFormat(f);

// Mantine отдаёт дату строкой «YYYY-MM-DD HH:mm:ss» — это «настенное» время в поясе пользователя.
export const toWall = (iso: string, tz: string) =>
  DateTime.fromISO(iso).setZone(tz).toFormat("yyyy-MM-dd HH:mm:ss");
export const fromWall = (wall: string, tz: string) =>
  DateTime.fromSQL(wall, { zone: tz }).toUTC().toISO()!;

export const ms = (iso: string) => DateTime.fromISO(iso).toMillis();
export const FREQ_LABEL = {
  none: "Не повторять",
  daily: "Каждый день",
  weekly: "Каждую неделю",
  monthly: "Каждый месяц",
} as const;
export const REMINDER_LABEL: Record<number, string> = { 10: "за 10 минут", 60: "за час", 1440: "за день" };
