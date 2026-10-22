import { createContext, useContext } from "react";
import type { Occurrence, User } from "./api";

export type EditorTarget =
  | { kind: "new"; start?: string } // start — «настенное» время в поясе пользователя
  | { kind: "note"; id: string }
  | { kind: "occ"; occ: Occurrence };

export const AppContext = createContext<{ user: User; openEditor: (t: EditorTarget) => void } | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppContext не задан");
  return ctx;
}
