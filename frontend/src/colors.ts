import type { User } from "./api";

// Палитра задач: 8 цветов, что означает каждый — пользователь называет сам (настройки → «Цвета и теги»).
export const PALETTE = [
  { key: "red", hex: "#e03131", ink: "#fff" },
  { key: "orange", hex: "#f76707", ink: "#fff" },
  { key: "yellow", hex: "#f2b705", ink: "#1f1600" },
  { key: "green", hex: "#2f9e44", ink: "#fff" },
  { key: "teal", hex: "#0c8599", ink: "#fff" },
  { key: "blue", hex: "#1c7ed6", ink: "#fff" },
  { key: "violet", hex: "#7048e8", ink: "#fff" },
  { key: "gray", hex: "#868e96", ink: "#fff" },
] as const;
export type ColorKey = (typeof PALETTE)[number]["key"];

export const colorHex = (key: string | null | undefined) => PALETTE.find((c) => c.key === key)?.hex;
export const colorInk = (key: string | null | undefined) => PALETTE.find((c) => c.key === key)?.ink ?? "#111";
export const colorLabel = (user: User, key: string | null | undefined) =>
  key ? (user.prefs.color_labels as Record<string, string>)[key] ?? key : "Без цвета";

// Цвет задачи на экране: свой цвет → цвет первого тега → нейтральный.
export const taskHex = (n: { color?: string | null; tags: { color: string }[] }) => colorHex(n.color) ?? n.tags[0]?.color;
